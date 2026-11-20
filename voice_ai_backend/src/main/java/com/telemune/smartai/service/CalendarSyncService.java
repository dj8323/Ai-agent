package com.telemune.smartai.service;

import com.telemune.smartai.db.Db;
import com.telemune.smartai.util.J;
import com.telemune.smartai.util.SecretBox;
import com.telemune.smartai.web.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Real calendars linked to an agent (table calendar_accounts) and the agent's free/busy check before it books.
 * Providers: Google Calendar and Microsoft 365 / Outlook.com (OAuth sign-in, keys in keys.env: calendar.google.*,
 * calendar.microsoft.*) and CalDAV (Yahoo, iCloud, Zoho, any other) with an app password.
 * Tokens and passwords are stored encrypted (SecretBox) and never logged.
 *
 * Booking flow: the agent asks the caller for a day and time → <calendar-check:…> → {@link #check} says free (with the exact
 * time) or busy/outside hours (with up to 3 free options) → the agent books with <calendar:…> → {@link #book} checks again
 * and writes the event into the connected calendar and the app's own list. "Right now" = calendar.immediateMinutes from now.
 * Without a connected calendar the same check runs on the app's own events and the owner's availability.
 */
@Service
public class CalendarSyncService {
  private static final Logger log = LoggerFactory.getLogger(CalendarSyncService.class);
  public static final List<String> CALDAV_LABELS = List.of("yahoo", "icloud", "zoho", "other");
  private static final Map<String, String> CALDAV_URLS = Map.of("yahoo", "https://caldav.calendar.yahoo.com", "icloud", "https://caldav.icloud.com",
      "zoho", "https://calendar.zoho.com/caldav/");
  private static final Map<String, String> NAMES = Map.of("google", "Google Calendar", "microsoft", "Outlook / Microsoft 365", "yahoo", "Yahoo Calendar",
      "icloud", "iCloud Calendar", "zoho", "Zoho Calendar", "other", "CalDAV calendar");
  private static final DateTimeFormatter TAG = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");
  private static final DateTimeFormatter SAY = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.US);
  private static final DateTimeFormatter DAV = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
  private static final SecureRandom RNG = new SecureRandom();

  private final Db db;
  private final Environment env;
  private final SecretBox box;
  private final AppConfigService config;
  private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10))
      .followRedirects(HttpClient.Redirect.NORMAL).build();
  /** OAuth sign-ins in progress: state → who started it (10 minutes). */
  private final Map<String, Pending> pending = new ConcurrentHashMap<>();

  private record Pending(String userId, String agentId, String provider, String redirectUri, String verifier, Instant at) {}
  public record Busy(Instant start, Instant end) {}

  public CalendarSyncService(Db db, Environment env, SecretBox box, AppConfigService config) {
    this.db = db;
    this.env = env;
    this.box = box;
    this.config = config;
  }

  /** JSON text → map; null for empty or bad text (never throws). */
  private static Map<String, Object> map(Object json) {
    String t = json == null ? "" : String.valueOf(json).trim();
    if (!t.startsWith("{")) return null;
    try { return J.readMap(t); } catch (Exception e) { return null; }
  }

  /** The older TelemuneSmartAi voice project's key names work too, so its settings can be copied as they are. */
  private static final Map<String, String> ALIASES = Map.of(
      "calendar.google.client-id", "google.oauth.client-id", "calendar.google.client-secret", "google.oauth.client-secret",
      "calendar.microsoft.client-id", "outlook.oauth.client-id", "calendar.microsoft.client-secret", "outlook.oauth.client-secret",
      "calendar.microsoft.tenant", "outlook.oauth.tenant");

  private String prop(String k, String def) {
    String v = env.getProperty(k);
    if ((v == null || v.isBlank()) && ALIASES.containsKey(k)) v = env.getProperty(ALIASES.get(k));
    return v == null || v.isBlank() ? def : v.trim();
  }

  // ---------- providers set up on this server ----------
  public boolean configured(String provider) {
    return switch (provider) {
      case "google" -> !prop("calendar.google.client-id", "").isEmpty() && !prop("calendar.google.client-secret", "").isEmpty();
      case "microsoft" -> !prop("calendar.microsoft.client-id", "").isEmpty() && !prop("calendar.microsoft.client-secret", "").isEmpty();
      case "caldav" -> true;
      default -> false;
    };
  }

  public Map<String, Object> providers() {
    return J.map("google", configured("google"), "microsoft", configured("microsoft"), "caldav", true);
  }

  // ---------- the agent's linked calendar ----------
  public Map<String, Object> row(String agentId) {
    return agentId == null ? null : db.one("SELECT * FROM calendar_accounts WHERE agent_id = ?", agentId);
  }

  public static String nameOf(Map<String, Object> row) {
    if (row == null) return null;
    String p = J.str(row.get("provider"));
    return NAMES.getOrDefault("caldav".equals(p) ? J.str(row.get("label")) : p, "Calendar");
  }

  /** What the page shows: never any token or password. */
  public Map<String, Object> describe(Map<String, Object> agent) {
    Map<String, Object> r = row(agent == null ? null : J.str(agent.get("id")));
    Map<String, Object> out = J.map("connected", r != null, "providers", providers(),
        "immediateMinutes", immediateMinutes(agent), "zone", zone(agent).getId());
    if (r != null) {
      out.putAll(J.map("provider", r.get("provider"), "label", r.get("label"), "name", nameOf(r), "account", r.get("account"),
          "status", r.get("status"), "lastError", r.get("last_error"), "connectedAt", J.iso(r.get("created_at"))));
    }
    return out;
  }

  public boolean disconnect(Map<String, Object> agent) {
    return db.exec("DELETE FROM calendar_accounts WHERE agent_id = ?", agent.get("id")) > 0;
  }

  private void save(String userId, String agentId, String provider, String label, String account, String calRef, Map<String, Object> secret) {
    db.exec("DELETE FROM calendar_accounts WHERE agent_id = ?", agentId);
    db.exec("INSERT INTO calendar_accounts (id, user_id, agent_id, provider, label, account, calendar_ref, secret, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok')",
        J.newId(), userId, agentId, provider, J.str(label, 20), J.str(account, 190), J.str(calRef, 500), box.seal(J.json(secret)));
  }

  private void markError(Map<String, Object> row, String msg) {
    db.exec("UPDATE calendar_accounts SET status = 'error', last_error = ? WHERE id = ?", J.str(msg, 300), row.get("id"));
  }

  private void markOk(Map<String, Object> row) {
    if (!"ok".equals(row.get("status"))) db.exec("UPDATE calendar_accounts SET status = 'ok', last_error = NULL WHERE id = ?", row.get("id"));
  }

  // ---------- OAuth (Google, Microsoft) ----------
  private static String b64url(byte[] b) { return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
  private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }

  private String authUrl(String p) {
    return "google".equals(p) ? prop("calendar.google.auth-url", "https://accounts.google.com/o/oauth2/v2/auth")
        : prop("calendar.microsoft.auth-url", "https://login.microsoftonline.com/" + prop("calendar.microsoft.tenant", "common") + "/oauth2/v2.0/authorize");
  }

  private String tokenUrl(String p) {
    return "google".equals(p) ? prop("calendar.google.token-url", "https://oauth2.googleapis.com/token")
        : prop("calendar.microsoft.token-url", "https://login.microsoftonline.com/" + prop("calendar.microsoft.tenant", "common") + "/oauth2/v2.0/token");
  }

  private String googleApi() { return prop("calendar.google.api-url", "https://www.googleapis.com/calendar/v3"); }
  private String graph() { return prop("calendar.microsoft.graph-url", "https://graph.microsoft.com/v1.0"); }
  // calendar.events only (plus sign-in basics): busy times come from the event list, so no extra sensitive scope needs Google's review
  private String googleScopes() { return prop("calendar.google.scopes", "openid email https://www.googleapis.com/auth/calendar.events"); }
  private static final String MS_SCOPES = "offline_access openid email User.Read Calendars.ReadWrite";

  /** The address Google/Microsoft send the person back to; must be registered in their console exactly like this. */
  public String redirectUri(String provider, String origin) {
    String base = prop("calendar.oauth.redirect-base", "");
    if (base.isEmpty()) {
      if (origin == null || !origin.matches("^https?://[A-Za-z0-9.\\-]+(:\\d{1,5})?$")) throw ApiException.bad("Can't tell this site's address; set calendar.oauth.redirect-base in keys.env.");
      base = origin;
    }
    return base.replaceAll("/+$", "") + "/api/calendar-oauth/" + provider + "/callback";
  }

  public String startOAuth(String provider, String userId, Map<String, Object> agent, String origin) {
    if (!List.of("google", "microsoft").contains(provider)) throw ApiException.bad("Unknown provider.");
    if (!configured(provider)) throw ApiException.bad(("google".equals(provider) ? "Google" : "Microsoft")
        + " sign-in isn't set up on this server yet. The SuperAdmin adds its client ID and secret to keys.env (see the calendar setup guide).");
    pending.values().removeIf(p -> p.at().isBefore(Instant.now().minus(Duration.ofMinutes(10))));
    byte[] s = new byte[24], v = new byte[32];
    RNG.nextBytes(s); RNG.nextBytes(v);
    String state = b64url(s), verifier = b64url(v), redirect = redirectUri(provider, origin);
    String challenge;
    try { challenge = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))); }
    catch (Exception e) { throw new IllegalStateException(e); }
    pending.put(state, new Pending(userId, J.str(agent.get("id")), provider, redirect, verifier, Instant.now()));
    String q = "google".equals(provider)
        ? "client_id=" + enc(prop("calendar.google.client-id", "")) + "&redirect_uri=" + enc(redirect) + "&response_type=code&scope=" + enc(googleScopes())
          + "&access_type=offline&prompt=consent&include_granted_scopes=true"
        : "client_id=" + enc(prop("calendar.microsoft.client-id", "")) + "&redirect_uri=" + enc(redirect) + "&response_type=code&response_mode=query&scope="
          + enc(MS_SCOPES) + "&prompt=select_account";
    log.info("Calendar sign-in started: {} for agent {}", provider, agent.get("id"));
    return authUrl(provider) + "?" + q + "&state=" + enc(state) + "&code_challenge=" + enc(challenge) + "&code_challenge_method=S256";
  }

  /** Back from Google/Microsoft: swap the code for tokens, read the account's email, store it (encrypted). */
  public Map<String, Object> finishOAuth(String provider, String code, String state, String userId) {
    Pending p = state == null ? null : pending.remove(state);
    if (p == null || !p.provider().equals(provider) || p.at().isBefore(Instant.now().minus(Duration.ofMinutes(10))))
      throw ApiException.bad("This sign-in link has expired. Start again from the calendar window.");
    if (!p.userId().equals(userId)) throw ApiException.forbidden("This sign-in was started by another account.");
    if (J.blank(code)) throw ApiException.bad("The sign-in was cancelled.");
    Map<String, Object> agent = db.one("SELECT * FROM agents WHERE id = ? AND user_id = ?", p.agentId(), userId);
    if (agent == null) throw ApiException.notFound("Agent not found.");
    String form = "code=" + enc(code) + "&redirect_uri=" + enc(p.redirectUri()) + "&grant_type=authorization_code&code_verifier=" + enc(p.verifier())
        + "&client_id=" + enc(prop("calendar." + provider + ".client-id", "")) + "&client_secret=" + enc(prop("calendar." + provider + ".client-secret", ""))
        + ("microsoft".equals(provider) ? "&scope=" + enc(MS_SCOPES) : "");
    Map<String, Object> tok = postForm(tokenUrl(provider), form);
    if (J.blank(tok.get("access_token"))) throw ApiException.bad("The sign-in didn't give calendar access: " + J.str(tok.get("error_description"), 160));
    String access = J.str(tok.get("access_token"));
    String email;
    if ("google".equals(provider)) {
      Map<String, Object> me = getJson(prop("calendar.google.userinfo-url", "https://openidconnect.googleapis.com/v1/userinfo"), access, null);
      email = J.str(me.get("email"));
    } else {
      Map<String, Object> me = getJson(graph() + "/me", access, null);
      email = J.str(me.get("mail"), 190);
      if (email.isEmpty()) email = J.str(me.get("userPrincipalName"), 190);
    }
    Map<String, Object> secret = J.map("access", access, "refresh", tok.get("refresh_token"),
        "exp", Instant.now().plusSeconds(Math.max(60, J.num(tok.get("expires_in")))).getEpochSecond());
    save(userId, p.agentId(), provider, "", email, "google".equals(provider) ? "primary" : "", secret);
    log.info("Calendar connected: {} for agent {}", provider, p.agentId());
    return J.map("provider", provider, "account", email, "agentId", p.agentId(), "agentName", agent.get("name"));
  }

  /** A valid access token for a Google/Microsoft account (refreshed when it's about to expire). */
  private String accessToken(Map<String, Object> row) {
    Map<String, Object> s = map(box.open(J.str(row.get("secret"))));
    if (s == null || J.blank(s.get("access"))) { markError(row, "Couldn't read the saved sign-in. Connect the calendar again."); throw ApiException.bad("Calendar sign-in is missing. Connect it again."); }
    if (Instant.now().getEpochSecond() < J.num(s.get("exp")) - 60) return J.str(s.get("access"));
    String provider = J.str(row.get("provider"));
    if (J.blank(s.get("refresh"))) { markError(row, "The sign-in has expired. Connect the calendar again."); throw ApiException.bad("The calendar sign-in has expired. Connect it again."); }
    String form = "grant_type=refresh_token&refresh_token=" + enc(J.str(s.get("refresh"))) + "&client_id=" + enc(prop("calendar." + provider + ".client-id", ""))
        + "&client_secret=" + enc(prop("calendar." + provider + ".client-secret", "")) + ("microsoft".equals(provider) ? "&scope=" + enc(MS_SCOPES) : "");
    Map<String, Object> tok = postForm(tokenUrl(provider), form);
    if (J.blank(tok.get("access_token"))) {
      markError(row, "The sign-in has expired or was removed. Connect the calendar again.");
      throw ApiException.bad("The calendar sign-in has expired. Connect it again.");
    }
    s.put("access", tok.get("access_token"));
    if (!J.blank(tok.get("refresh_token"))) s.put("refresh", tok.get("refresh_token"));
    s.put("exp", Instant.now().plusSeconds(Math.max(60, J.num(tok.get("expires_in")))).getEpochSecond());
    db.exec("UPDATE calendar_accounts SET secret = ? WHERE id = ?", box.seal(J.json(s)), row.get("id"));
    return J.str(s.get("access"));
  }

  // ---------- CalDAV (Yahoo, iCloud, Zoho, other) ----------
  public Map<String, Object> connectCaldav(String userId, Map<String, Object> agent, String label, String url, String username, String password) {
    String l = CALDAV_LABELS.contains(label) ? label : "other";
    String base = J.blank(url) ? CALDAV_URLS.getOrDefault(l, "") : url.trim();
    if (!base.matches("^https?://\\S+$")) throw ApiException.bad("Enter the calendar's CalDAV address (it starts with https://).");
    if (J.blank(username) || J.blank(password)) throw ApiException.bad("Enter the user name (usually your email) and an app password.");
    String coll = discover(base, username.trim(), password);
    save(userId, J.str(agent.get("id")), "caldav", l, username.trim(), coll, J.map("user", username.trim(), "pass", password));
    log.info("Calendar connected: caldav/{} for agent {}", l, agent.get("id"));
    return J.map("provider", "caldav", "label", l, "account", username.trim());
  }

  private String basic(String user, String pass) {
    return "Basic " + Base64.getEncoder().encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8));
  }

  private HttpResponse<String> dav(String method, String url, String auth, String depth, String body) {
    try {
      HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20)).header("Authorization", auth)
          .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
      if (depth != null) b.header("Depth", depth);
      if (body != null) b.header("Content-Type", "application/xml; charset=utf-8");
      return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    } catch (Exception e) {
      throw ApiException.bad("Couldn't reach the calendar server: " + J.str(e.getMessage(), 120));
    }
  }

  private static Document xml(String body) {
    try {
      DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
      f.setNamespaceAware(true);
      f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true); // no external entities
      f.setExpandEntityReferences(false);
      return f.newDocumentBuilder().parse(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      return null;
    }
  }

  private static List<Element> byName(Node root, String local) {
    List<Element> out = new ArrayList<>();
    if (root == null) return out;
    NodeList all = root instanceof Document d ? d.getElementsByTagNameNS("*", local) : ((Element) root).getElementsByTagNameNS("*", local);
    for (int i = 0; i < all.getLength(); i++) out.add((Element) all.item(i));
    return out;
  }

  private static String hrefIn(Element parent, String prop) {
    for (Element p : byName(parent, prop)) for (Element h : byName(p, "href")) return h.getTextContent().trim();
    return null;
  }

  private static String resolve(String base, String href) {
    try { return URI.create(base).resolve(href).toString(); } catch (Exception e) { return href; }
  }

  private static final String PROPS = "<d:propfind xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><d:resourcetype/><d:displayname/>"
      + "<d:current-user-principal/><c:calendar-home-set/><c:supported-calendar-component-set/></d:prop></d:propfind>";

  /** Finds the first calendar (that holds events) for this account; returns its URL. */
  private String discover(String base, String user, String pass) {
    String auth = basic(user, pass);
    String start = base.endsWith("/") || base.contains("/caldav/") ? base : base + "/";
    for (String url : List.of(start, resolve(start, "/.well-known/caldav"))) {
      HttpResponse<String> r = dav("PROPFIND", url, auth, "0", PROPS);
      if (r.statusCode() == 401 || r.statusCode() == 403) throw ApiException.bad("The calendar server refused the user name or app password.");
      if (r.statusCode() != 207) continue;
      Document doc = xml(r.body());
      String here = r.uri().toString();
      // the address is a calendar itself
      for (Element resp : byName(doc, "response")) {
        if (!byName(resp, "calendar").isEmpty() && byName(resp, "calendar-home-set").isEmpty()) return resolve(here, byName(resp, "href").get(0).getTextContent().trim());
      }
      String home = hrefIn(doc.getDocumentElement(), "calendar-home-set");
      if (home == null) {
        String principal = hrefIn(doc.getDocumentElement(), "current-user-principal");
        if (principal == null) continue;
        HttpResponse<String> pr = dav("PROPFIND", resolve(here, principal), auth, "0", PROPS);
        if (pr.statusCode() != 207) continue;
        home = hrefIn(xml(pr.body()).getDocumentElement(), "calendar-home-set");
        here = pr.uri().toString();
        if (home == null) continue;
      }
      String homeUrl = resolve(here, home);
      HttpResponse<String> hr = dav("PROPFIND", homeUrl, auth, "1", PROPS);
      if (hr.statusCode() != 207) continue;
      for (Element resp : byName(xml(hr.body()), "response")) {
        if (byName(resp, "calendar").isEmpty()) continue;
        List<Element> comps = byName(resp, "comp");
        boolean events = comps.isEmpty() || comps.stream().anyMatch(c -> "VEVENT".equalsIgnoreCase(c.getAttribute("name")));
        if (events) return resolve(hr.uri().toString(), byName(resp, "href").get(0).getTextContent().trim());
      }
    }
    throw ApiException.bad("Couldn't find a calendar at that address. Check the CalDAV address, user name and app password.");
  }

  private String caldavAuth(Map<String, Object> row) {
    Map<String, Object> s = map(box.open(J.str(row.get("secret"))));
    if (s == null) { markError(row, "Couldn't read the saved app password. Connect the calendar again."); throw ApiException.bad("Calendar password is missing. Connect it again."); }
    return basic(J.str(s.get("user")), J.str(s.get("pass")));
  }

  private String calendarQuery(Instant from, Instant to, boolean expand) {
    String range = "start=\"" + DAV.format(from) + "\" end=\"" + DAV.format(to) + "\"";
    return "<c:calendar-query xmlns:d=\"DAV:\" xmlns:c=\"urn:ietf:params:xml:ns:caldav\"><d:prop><c:calendar-data>"
        + (expand ? "<c:expand " + range + "/>" : "") + "</c:calendar-data></d:prop><c:filter><c:comp-filter name=\"VCALENDAR\">"
        + "<c:comp-filter name=\"VEVENT\"><c:time-range " + range + "/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>";
  }

  private List<Busy> caldavBusy(Map<String, Object> row, Instant from, Instant to, ZoneId zone) {
    HttpResponse<String> r = dav("REPORT", J.str(row.get("calendar_ref")), caldavAuth(row), "1", calendarQuery(from, to, true));
    if (r.statusCode() == 401) { markError(row, "The app password was refused. Connect the calendar again."); throw ApiException.bad("The calendar refused the app password."); }
    if (r.statusCode() != 207) throw ApiException.bad("The calendar server answered " + r.statusCode() + ".");
    List<Busy> out = new ArrayList<>();
    for (Element cd : byName(xml(r.body()), "calendar-data")) out.addAll(parseIcs(cd.getTextContent(), zone));
    return out;
  }

  private static final Pattern PROP = Pattern.compile("^([A-Z-]+)((?:;[^:]*)?):(.*)$");

  /** Busy times from iCalendar text (DTSTART/DTEND or DURATION; TZID, UTC and all-day dates; TRANSP:TRANSPARENT is free). */
  static List<Busy> parseIcs(String ics, ZoneId zone) {
    List<Busy> out = new ArrayList<>();
    String unfolded = ics.replace("\r\n", "\n").replaceAll("\n[ \t]", "");
    for (String block : unfolded.split("BEGIN:VEVENT")) {
      int end = block.indexOf("END:VEVENT");
      if (end < 0) continue;
      Instant s = null, e = null; Duration dur = null; boolean free = false, allDay = false;
      for (String line : block.substring(0, end).split("\n")) {
        Matcher m = PROP.matcher(line.trim());
        if (!m.matches()) continue;
        String name = m.group(1), params = m.group(2), val = m.group(3).trim();
        try {
          if ("DTSTART".equals(name)) { s = icsTime(params, val, zone); allDay = val.length() == 8; }
          else if ("DTEND".equals(name)) e = icsTime(params, val, zone);
          else if ("DURATION".equals(name)) dur = Duration.parse(val.replace("P", "PT").replace("PTT", "PT").replaceAll("PT(\\d+)D", "P$1D"));
          else if ("TRANSP".equals(name)) free = "TRANSPARENT".equalsIgnoreCase(val);
        } catch (Exception ignored) { /* skip a value we can't read */ }
      }
      if (s == null || free) continue;
      if (e == null) e = dur != null ? s.plus(dur) : allDay ? s.plus(Duration.ofDays(1)) : s;
      if (e.isAfter(s)) out.add(new Busy(s, e));
    }
    return out;
  }

  private static Instant icsTime(String params, String v, ZoneId zone) {
    if (v.length() == 8) return LocalDate.parse(v, DateTimeFormatter.BASIC_ISO_DATE).atStartOfDay(zone).toInstant();
    LocalDateTime t = LocalDateTime.parse(v.replace("Z", ""), DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss"));
    if (v.endsWith("Z")) return t.toInstant(ZoneOffset.UTC);
    Matcher tz = Pattern.compile("TZID=([^;:]+)").matcher(params == null ? "" : params);
    ZoneId z = zone;
    if (tz.find()) { try { z = ZoneId.of(tz.group(1).replace("\"", "")); } catch (Exception ignored) { /* unknown name: the agent's zone */ } }
    return t.atZone(z).toInstant();
  }

  // ---------- busy times from the linked calendar ----------
  public List<Busy> providerBusy(Map<String, Object> row, Instant from, Instant to, ZoneId zone) {
    String p = J.str(row.get("provider"));
    List<Busy> out = new ArrayList<>();
    if ("google".equals(p)) {
      // the event list (calendar.events scope): every event that isn't cancelled, marked "free" or declined counts as busy
      String cal = enc(J.str(row.get("calendar_ref"), 300).isEmpty() ? "primary" : J.str(row.get("calendar_ref")));
      String base = googleApi() + "/calendars/" + cal + "/events?singleEvents=true&orderBy=startTime&maxResults=250"
          + "&timeMin=" + enc(from.toString()) + "&timeMax=" + enc(to.toString());
      String pageToken = null;
      for (int page = 0; page < 5; page++) {
        Map<String, Object> res = getJson(base + (pageToken == null ? "" : "&pageToken=" + enc(pageToken)), accessToken(row), null);
        for (Object v : J.list(res.get("items"))) {
          Map<String, Object> ev = J.obj(v);
          if ("cancelled".equals(ev.get("status")) || "transparent".equals(ev.get("transparency"))) continue;
          boolean declined = J.list(ev.get("attendees")).stream().map(J::obj).anyMatch(a -> J.bool(a.get("self")) && "declined".equals(a.get("responseStatus")));
          if (declined) continue;
          Instant s = googleTime(J.obj(ev.get("start")), zone), e = googleTime(J.obj(ev.get("end")), zone);
          if (s != null && e != null && e.isAfter(s)) out.add(new Busy(s, e));
        }
        pageToken = J.blank(res.get("nextPageToken")) ? null : J.str(res.get("nextPageToken"));
        if (pageToken == null) break;
      }
    } else if ("microsoft".equals(p)) {
      String url = graph() + "/me/calendarView?startDateTime=" + enc(from.toString()) + "&endDateTime=" + enc(to.toString()) + "&$select=start,end,showAs&$top=200";
      for (int page = 0; url != null && page < 5; page++) {
        Map<String, Object> res = getJson(url, accessToken(row), Map.of("Prefer", "outlook.timezone=\"UTC\""));
        for (Object v : J.list(res.get("value"))) {
          Map<String, Object> ev = J.obj(v);
          if ("free".equalsIgnoreCase(J.str(ev.get("showAs")))) continue;
          out.add(new Busy(msTime(J.obj(ev.get("start"))), msTime(J.obj(ev.get("end")))));
        }
        url = J.blank(res.get("@odata.nextLink")) ? null : J.str(res.get("@odata.nextLink"));
      }
    } else if ("caldav".equals(p)) {
      out.addAll(caldavBusy(row, from, to, zone));
    }
    markOk(row);
    return out;
  }

  /** Google event time: dateTime (with offset) or an all-day date in the owner's zone. */
  private static Instant googleTime(Map<String, Object> t, ZoneId zone) {
    try {
      if (!J.blank(t.get("dateTime"))) return OffsetDateTime.parse(J.str(t.get("dateTime"))).toInstant();
      if (!J.blank(t.get("date"))) return LocalDate.parse(J.str(t.get("date"))).atStartOfDay(zone).toInstant();
    } catch (Exception ignored) { /* unreadable time: skip */ }
    return null;
  }

  private static Instant msTime(Map<String, Object> t) {
    String v = J.str(t.get("dateTime"));
    if (v.length() > 19) v = v.substring(0, 19);
    return LocalDateTime.parse(v).toInstant(ZoneOffset.UTC);
  }

  /** Adds the event to the linked calendar; returns its id there. */
  private String providerCreate(Map<String, Object> row, String title, Instant start, Instant end, String notes, ZoneId zone) {
    String p = J.str(row.get("provider"));
    String desc = "Booked by your TelemuneSmartAi agent" + (J.blank(notes) ? "." : ": " + notes);
    if ("google".equals(p)) {
      Map<String, Object> res = postJson(googleApi() + "/calendars/" + enc(J.str(row.get("calendar_ref"), 300).isEmpty() ? "primary" : J.str(row.get("calendar_ref"))) + "/events",
          accessToken(row), J.map("summary", title, "description", desc,
              "start", J.map("dateTime", start.toString(), "timeZone", zone.getId()), "end", J.map("dateTime", end.toString(), "timeZone", zone.getId())));
      if (J.blank(res.get("id"))) throw ApiException.bad("Google Calendar didn't accept the event.");
      return J.str(res.get("id"));
    }
    if ("microsoft".equals(p)) {
      DateTimeFormatter f = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss").withZone(ZoneOffset.UTC);
      Map<String, Object> res = postJson(graph() + "/me/events", accessToken(row), J.map("subject", title,
          "body", J.map("contentType", "text", "content", desc),
          "start", J.map("dateTime", f.format(start), "timeZone", "UTC"), "end", J.map("dateTime", f.format(end), "timeZone", "UTC")));
      if (J.blank(res.get("id"))) throw ApiException.bad("Outlook didn't accept the event.");
      return J.str(res.get("id"), 300);
    }
    String uid = J.newId() + "-" + Long.toHexString(System.currentTimeMillis()) + "@telemunesmartai";
    String ics = String.join("\r\n", "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TelemuneSmartAi//Calendar//EN", "BEGIN:VEVENT", "UID:" + uid,
        "DTSTAMP:" + DAV.format(Instant.now()), "DTSTART:" + DAV.format(start), "DTEND:" + DAV.format(end),
        "SUMMARY:" + title.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", " "),
        "DESCRIPTION:" + desc.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", " "), "END:VEVENT", "END:VCALENDAR") + "\r\n";
    String coll = J.str(row.get("calendar_ref"));
    String url = (coll.endsWith("/") ? coll : coll + "/") + uid.replace("@", "-") + ".ics";
    try {
      HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20)).header("Authorization", caldavAuth(row))
          .header("Content-Type", "text/calendar; charset=utf-8").header("If-None-Match", "*").PUT(HttpRequest.BodyPublishers.ofString(ics)).build(),
          HttpResponse.BodyHandlers.ofString());
      if (r.statusCode() >= 300) throw ApiException.bad("The calendar server didn't accept the event (" + r.statusCode() + ").");
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw ApiException.bad("Couldn't reach the calendar server: " + J.str(e.getMessage(), 120));
    }
    return url;
  }

  // ---------- HTTP helpers (JSON) ----------
  private Map<String, Object> postForm(String url, String form) {
    try {
      HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20))
          .header("Content-Type", "application/x-www-form-urlencoded").header("Accept", "application/json")
          .POST(HttpRequest.BodyPublishers.ofString(form)).build(), HttpResponse.BodyHandlers.ofString());
      Map<String, Object> m = map(r.body());
      if (r.statusCode() >= 400) log.warn("Calendar sign-in endpoint answered {}: {}", r.statusCode(), m == null ? "" : J.str(m.get("error"), 80));
      return m == null ? new LinkedHashMap<>() : m;
    } catch (Exception e) {
      throw ApiException.bad("Couldn't reach the sign-in service: " + J.str(e.getMessage(), 120));
    }
  }

  private Map<String, Object> send(HttpRequest.Builder b, String what) {
    try {
      HttpResponse<String> r = http.send(b.timeout(Duration.ofSeconds(20)).header("Accept", "application/json").build(), HttpResponse.BodyHandlers.ofString());
      Map<String, Object> m = map(r.body());
      if (r.statusCode() >= 400) {
        String msg = m == null ? "" : J.str(J.get(m, "error.message"), 160);
        log.warn("{} answered {}: {}", what, r.statusCode(), msg);
        throw ApiException.bad(what + " answered " + r.statusCode() + (msg.isEmpty() ? "" : ": " + msg));
      }
      return m == null ? new LinkedHashMap<>() : m;
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw ApiException.bad("Couldn't reach " + what + ": " + J.str(e.getMessage(), 120));
    }
  }

  private Map<String, Object> getJson(String url, String token, Map<String, String> headers) {
    HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).header("Authorization", "Bearer " + token).GET();
    if (headers != null) headers.forEach(b::header);
    return send(b, "The calendar service");
  }

  private Map<String, Object> postJson(String url, String token, Object body) {
    return send(HttpRequest.newBuilder(URI.create(url)).header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(J.json(body))), "The calendar service");
  }

  // ---------- free/busy check, suggestions, booking ----------
  public ZoneId zone(Map<String, Object> agent) {
    Map<String, Object> plan = agent == null ? null : map(J.str(agent.get("availability_plan")));
    String tz = plan == null ? "" : J.str(plan.get("tz"));
    try { return tz.isEmpty() ? ZoneId.systemDefault() : ZoneId.of(tz); } catch (Exception e) { return ZoneId.systemDefault(); }
  }

  public long immediateMinutes(Map<String, Object> agent) {
    Long own = agent == null ? null : J.numOrNull(agent.get("calendar_immediate_min"));
    long def = J.num(J.get(config.app(), "calendar.immediateMinutes"));
    return Math.max(0, Math.min(240, own != null ? own : def > 0 ? def : 5));
  }

  /** "2026-11-21T15:00" in the agent's zone, "NOW" (= immediateMinutes from now) or an ISO instant. */
  public Instant parseWhen(String when, Map<String, Object> agent) {
    String w = J.str(when).trim();
    if (w.isEmpty()) throw ApiException.bad("Give a day and time.");
    if (w.equalsIgnoreCase("now") || w.equalsIgnoreCase("asap") || w.equalsIgnoreCase("immediately")) {
      return Instant.now().plus(Duration.ofMinutes(immediateMinutes(agent))).truncatedTo(ChronoUnit.MINUTES).plus(Duration.ofMinutes(1));
    }
    try {
      if (w.endsWith("Z") || w.matches(".*[+-]\\d\\d:\\d\\d$")) return OffsetDateTime.parse(w).toInstant();
      return LocalDateTime.parse(w.length() == 16 ? w : w.substring(0, Math.min(19, w.length()))).atZone(zone(agent)).toInstant();
    } catch (Exception e) {
      throw ApiException.bad("The time should look like 2026-11-21T15:00.");
    }
  }

  /** Is this time inside the owner's working days/hours (availability picker)? Empty plan = always. */
  static String outsideHours(Map<String, Object> plan, ZonedDateTime s, ZonedDateTime e) {
    if (plan == null) return null;
    for (Object d : J.list(plan.get("offDates"))) if (s.toLocalDate().toString().equals(J.str(d))) return "that day is marked as a day off";
    List<Object> days = J.list(plan.get("days"));
    if (!days.isEmpty() && days.stream().noneMatch(d -> J.num(d) == s.getDayOfWeek().getValue())) return "it's not a working day";
    if (J.bool(plan.get("allDay"))) return null;
    try {
      LocalTime from = LocalTime.parse(J.str(plan.get("from"))), to = LocalTime.parse(J.str(plan.get("to")));
      if (s.toLocalTime().isBefore(from) || e.toLocalTime().isAfter(to) || !e.toLocalDate().equals(s.toLocalDate()) && !to.equals(LocalTime.MAX))
        return "it's outside working hours (" + from + "–" + to + ")";
    } catch (Exception ignored) { /* no hours set */ }
    return null;
  }

  private static boolean overlaps(List<Busy> busy, Instant s, Instant e) {
    for (Busy b : busy) if (b.start().isBefore(e) && b.end().isAfter(s)) return true;
    return false;
  }

  private List<Busy> localBusy(String userId, String agentId, Instant from, Instant to) {
    List<Busy> out = new ArrayList<>();
    for (Map<String, Object> r : db.query("SELECT start_at, duration_min FROM calendar_events WHERE user_id = ? AND (agent_id = ? OR agent_id IS NULL) "
        + "AND start_at < ? AND start_at > ? - INTERVAL 1 DAY", userId, agentId, J.utc(to), J.utc(from))) {
      Object v = r.get("start_at");
      LocalDateTime t = v instanceof LocalDateTime d ? d : v instanceof java.sql.Timestamp ts ? ts.toLocalDateTime() : null;
      if (t == null) continue;
      Instant s = t.toInstant(ZoneOffset.UTC);
      out.add(new Busy(s, s.plus(Duration.ofMinutes(J.num(r.get("duration_min"))))));
    }
    return out;
  }

  private Map<String, Object> slot(Instant s, ZoneId z) {
    ZonedDateTime t = s.atZone(z);
    return J.map("start", s.toString(), "local", TAG.format(t), "say", SAY.format(t));
  }

  /**
   * Can the owner meet at this time? Answers {free, start, end, local, say, minutes, reason, suggestions:[{start, local, say}],
   * calendar: "Google Calendar" | "the app's calendar", calendarError?}.
   */
  public Map<String, Object> check(Map<String, Object> agent, String userId, String when, long minutes) {
    ZoneId z = zone(agent);
    long mins = Math.max(5, Math.min(24 * 60, minutes > 0 ? minutes : Math.max(5, J.num(J.get(config.forAgent(agent), "calendar.defaultDurationMin")))));
    Instant start = parseWhen(when, agent), end = start.plus(Duration.ofMinutes(mins));
    Map<String, Object> cfg = config.app();
    int days = (int) Math.max(1, Math.min(60, J.num(J.get(cfg, "calendar.suggestDays")) == 0 ? 14 : J.num(J.get(cfg, "calendar.suggestDays"))));
    long step = Math.max(15, J.num(J.get(cfg, "calendar.slotStepMin")) == 0 ? 30 : J.num(J.get(cfg, "calendar.slotStepMin")));
    Map<String, Object> plan = map(J.str(agent.get("availability_plan")));
    Map<String, Object> row = row(J.str(agent.get("id")));
    Instant earliest = Instant.now().plus(Duration.ofMinutes(immediateMinutes(agent))).truncatedTo(ChronoUnit.MINUTES);
    Instant rangeFrom = start.isBefore(earliest) ? earliest : start, rangeTo = rangeFrom.plus(Duration.ofDays(days));
    List<Busy> busy = new ArrayList<>(localBusy(userId, J.str(agent.get("id")), rangeFrom.minus(Duration.ofDays(1)), rangeTo));
    String calError = null;
    if (row != null) {
      try { busy.addAll(providerBusy(row, rangeFrom.minus(Duration.ofHours(12)), rangeTo, z)); }
      catch (ApiException e) { calError = e.getMessage(); log.warn("Free/busy check failed for agent {}: {}", agent.get("id"), e.getMessage()); }
    }
    String reason = null;
    if (start.isBefore(Instant.now().minus(Duration.ofMinutes(1)))) reason = "that time has already passed";
    if (reason == null) reason = outsideHours(plan, start.atZone(z), end.atZone(z));
    if (reason == null && overlaps(busy, start, end)) reason = "there's already something in the calendar then";
    List<Map<String, Object>> sugg = new ArrayList<>();
    if (reason != null) {
      Instant t = rangeFrom.truncatedTo(ChronoUnit.MINUTES);
      long rem = (t.atZone(z).getMinute() % step);
      if (rem != 0) t = t.plus(Duration.ofMinutes(step - rem));
      Instant last = null;
      while (t.isBefore(rangeTo) && sugg.size() < 3) {
        Instant e = t.plus(Duration.ofMinutes(mins));
        if (outsideHours(plan, t.atZone(z), e.atZone(z)) == null && !overlaps(busy, t, e)
            && (last == null || Duration.between(last, t).toMinutes() >= 90)) { sugg.add(slot(t, z)); last = t; }
        t = t.plus(Duration.ofMinutes(step));
      }
    }
    Map<String, Object> out = J.map("free", reason == null, "minutes", mins, "zone", z.getId(), "reason", reason, "suggestions", sugg,
        "calendar", row != null ? nameOf(row) : "the app's calendar", "immediate", J.str(when).trim().equalsIgnoreCase("now"));
    out.putAll(slot(start, z));
    out.put("end", end.toString());
    if (calError != null) out.put("calendarError", calError);
    return out;
  }

  /** Books it: checks the slot again, writes it into the linked calendar (if any) and the app's own list. */
  public Map<String, Object> book(Map<String, Object> agent, String userId, String title, String when, long minutes, String notes, String source) {
    if (J.blank(title)) throw ApiException.bad("An event needs a title.");
    Map<String, Object> chk = check(agent, userId, when, minutes);
    if (!J.bool(chk.get("free"))) {
      Map<String, Object> busy = new LinkedHashMap<>(chk);
      busy.put("booked", false);
      return busy;
    }
    Instant start = Instant.parse(J.str(chk.get("start"))), end = Instant.parse(J.str(chk.get("end")));
    Map<String, Object> row = row(J.str(agent.get("id")));
    String extId = null, extError = null;
    if (row != null) {
      try { extId = providerCreate(row, J.str(title, 120), start, end, notes, zone(agent)); markOk(row); }
      catch (ApiException e) { extError = e.getMessage(); log.warn("Couldn't add the event to {} for agent {}: {}", row.get("provider"), agent.get("id"), e.getMessage()); }
    }
    String id = J.newId();
    db.exec("INSERT INTO calendar_events (id, user_id, agent_id, title, start_at, duration_min, notes, source, external_provider, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, userId, agent.get("id"), J.str(title, 120), J.utc(start), J.num(chk.get("minutes")), J.str(notes, 500),
        J.blank(source) ? "agent" : J.str(source, 40), extId == null ? null : row.get("provider"), extId);
    Map<String, Object> out = new LinkedHashMap<>(chk);
    out.putAll(J.map("booked", true, "id", id, "title", J.str(title, 120), "durationMin", chk.get("minutes"),
        "inCalendar", extId != null, "calendar", extId != null ? nameOf(row) : "the app's calendar"));
    if (extError != null) out.put("calendarError", extError);
    log.info("Meeting booked for agent {} ({} min){}", agent.get("id"), chk.get("minutes"), extId != null ? " in " + row.get("provider") : "");
    return out;
  }
}
