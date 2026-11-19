package com.telemune.smartai;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * TelemuneSmartAi backend: every /api route (accounts, agents, templates, calls, messages, calendar, admin) plus the
 * OpenAI calls (streamed chat over SSE, TTS, transcription, summaries). Everything is stored in MySQL (database ai-agent).
 * The browser talks to voice_ai_web, which serves the pages and forwards /api/* here.
 */
@SpringBootApplication
public class SmartAiApplication {
  public static void main(String[] args) {
    SpringApplication.run(SmartAiApplication.class, args);
  }
}
