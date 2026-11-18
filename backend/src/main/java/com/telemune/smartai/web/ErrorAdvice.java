package com.telemune.smartai.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

/** Every error leaves as JSON { "error": "..." } (never an empty body), like the old Node server. */
@RestControllerAdvice
public class ErrorAdvice {
  private static final Logger log = LoggerFactory.getLogger(ErrorAdvice.class);

  @ExceptionHandler(ApiException.class)
  ResponseEntity<Map<String, Object>> api(ApiException e) {
    return ResponseEntity.status(e.status).body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<Map<String, Object>> badJson(HttpMessageNotReadableException e) {
    return ResponseEntity.badRequest().body(Map.of("error", "Bad JSON"));
  }

  @ExceptionHandler(NoResourceFoundException.class)
  ResponseEntity<Map<String, Object>> notFound(NoResourceFoundException e) {
    return ResponseEntity.status(404).body(Map.of("error", "Unknown API route /" + e.getResourcePath()));
  }

  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  ResponseEntity<Map<String, Object>> method(HttpRequestMethodNotSupportedException e) {
    return ResponseEntity.status(405).body(Map.of("error", "Method " + e.getMethod() + " not allowed here"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, Object>> other(Exception e) {
    log.error("Request failed", e);
    return ResponseEntity.status(500).body(Map.of("error", "Server error"));
  }
}
