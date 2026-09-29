/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║         RAFIQ PLATFORM — Structured Logger Utility                             ║
 * ║                                                                                ║
 * ║  🔧 FIX L-04: Production logs use clean JSON without emoji                    ║
 * ║                                                                                ║
 * ║  In development: Emoji + colorful output (human-friendly)                     ║
 * ║  In production:  Clean JSON logs (machine-parseable, Datadog/ELK ready)       ║
 * ║                                                                                ║
 * ║  Usage:                                                                        ║
 * ║    import { StructuredLogger } from './common/utils/structured-logger';        ║
 * ║    const logger = new StructuredLogger('MyService');                           ║
 * ║    logger.log('Event processed', { eventId: '123', duration: 45 });           ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { LoggerService, LogLevel } from '@nestjs/common';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Strip emoji from log messages in production
 * Emoji breaks many log aggregation tools (grep, awk, structured parsers)
 */
function sanitizeMessage(msg: string): string {
  if (!IS_PRODUCTION) return msg;

  // Remove pictographic symbols and variation selectors without treating
  // multi-codepoint emoji sequences as individual character classes.
  return msg
    .replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export class StructuredLogger implements LoggerService {
  private context: string;

  constructor(context: string = 'App') {
    this.context = context;
  }

  log(message: string, ...optionalParams: unknown[]): void {
    this.writeLog('info', message, optionalParams);
  }

  error(message: string, ...optionalParams: unknown[]): void {
    this.writeLog('error', message, optionalParams);
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    this.writeLog('warn', message, optionalParams);
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    this.writeLog('debug', message, optionalParams);
  }

  verbose(message: string, ...optionalParams: unknown[]): void {
    this.writeLog('verbose', message, optionalParams);
  }

  fatal(message: string, ...optionalParams: unknown[]): void {
    this.writeLog('fatal', message, optionalParams);
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // Can be implemented if needed
  }

  private writeLog(level: string, message: string, params: unknown[]): void {
    const cleanMessage = sanitizeMessage(message);

    if (IS_PRODUCTION) {
      // ── Production: Structured JSON output ──
      const logEntry: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level,
        context: this.context,
        message: cleanMessage,
      };

      // Merge additional context
      if (params.length > 0) {
        const lastParam = params[params.length - 1];
        if (typeof lastParam === 'object' && lastParam !== null && !Array.isArray(lastParam)) {
          logEntry.metadata = lastParam;
        } else if (typeof lastParam === 'string') {
          logEntry.context = lastParam;
        }
      }

      const output = JSON.stringify(logEntry);

      if (level === 'error' || level === 'fatal') {
        process.stderr.write(output + '\n');
      } else {
        process.stdout.write(output + '\n');
      }
    } else {
      // ── Development: Human-friendly with color + emoji ──
      const consoleMethod =
        level === 'error' || level === 'fatal'
          ? console.error
          : level === 'warn'
            ? console.warn
            : level === 'debug' || level === 'verbose'
              ? console.debug
              : console.log;

      consoleMethod(`[${this.context}] ${message}`, ...params);
    }
  }
}

/**
 * Factory for NestJS logger replacement
 * Use in main.ts: app = await NestFactory.create(AppModule, { logger: createAppLogger() });
 */
export function createAppLogger(): StructuredLogger {
  return new StructuredLogger('Rafiq');
}
