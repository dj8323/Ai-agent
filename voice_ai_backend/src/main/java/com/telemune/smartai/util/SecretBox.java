package com.telemune.smartai.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Encrypts small secrets kept in MySQL (calendar tokens, CalDAV app passwords) with AES-256-GCM.
 * Key: CALENDAR_TOKEN_KEY in .env (base64, 32 bytes). If it is missing on start, a new one is written to .env once
 * (secrets live only in .env). Losing the key means connected calendars must be connected again; nothing else breaks.
 * Stored form: "v1:" + base64(12-byte IV + ciphertext + tag).
 */
@Component
public class SecretBox {
  private static final Logger log = LoggerFactory.getLogger(SecretBox.class);
  private static final SecureRandom RNG = new SecureRandom();
  private final byte[] key;

  public SecretBox(Environment env, @Value("${app.home}") String home) {
    String k = env.getProperty("CALENDAR_TOKEN_KEY", "").trim();
    if (k.isEmpty()) {
      byte[] fresh = new byte[32];
      RNG.nextBytes(fresh);
      k = Base64.getEncoder().encodeToString(fresh);
      try {
        Path envFile = Path.of(home).toAbsolutePath().normalize().resolve(".env");
        String add = (Files.exists(envFile) && !Files.readString(envFile).endsWith("\n") ? "\n" : "")
            + "\n# Encrypts connected calendar tokens and CalDAV app passwords in MySQL. Made automatically; keep it, or connected calendars must be connected again.\n"
            + "CALENDAR_TOKEN_KEY=" + k + "\n";
        Files.writeString(envFile, add, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        log.info("Created CALENDAR_TOKEN_KEY in .env (calendar tokens are encrypted with it)");
      } catch (Exception e) {
        log.warn("CALENDAR_TOKEN_KEY is missing and couldn't be written to .env ({}); connected calendars won't survive a restart", e.getMessage());
      }
    }
    byte[] raw;
    try { raw = Base64.getDecoder().decode(k); } catch (IllegalArgumentException e) { raw = new byte[0]; }
    if (raw.length != 32) {
      // any other text: derive 32 bytes from it, so a hand-typed key still works
      try { raw = java.security.MessageDigest.getInstance("SHA-256").digest(k.getBytes(StandardCharsets.UTF_8)); }
      catch (Exception e) { throw new IllegalStateException(e); }
    }
    this.key = raw;
  }

  public String seal(String plain) {
    if (plain == null) return null;
    try {
      byte[] iv = new byte[12];
      RNG.nextBytes(iv);
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
      byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
      byte[] out = new byte[iv.length + ct.length];
      System.arraycopy(iv, 0, out, 0, iv.length);
      System.arraycopy(ct, 0, out, iv.length, ct.length);
      return "v1:" + Base64.getEncoder().encodeToString(out);
    } catch (Exception e) {
      throw new IllegalStateException("Couldn't encrypt", e);
    }
  }

  /** null when it can't be opened (wrong key, damaged). */
  public String open(String sealed) {
    if (sealed == null || !sealed.startsWith("v1:")) return null;
    try {
      byte[] all = Base64.getDecoder().decode(sealed.substring(3));
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, all, 0, 12));
      return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
    } catch (Exception e) {
      return null;
    }
  }
}
