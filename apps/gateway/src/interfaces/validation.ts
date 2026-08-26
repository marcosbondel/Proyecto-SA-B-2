import { ValidationPipe } from '@nestjs/common';
import type { PipeTransform, Type } from '@nestjs/common';

/**
 * Validates a body against a DTO, naming the class explicitly.
 *
 * The global pipe would normally infer the class from `design:paramtypes`,
 * which TypeScript only emits when the DTO is imported as a **value**. Lint
 * rules that rewrite unused-as-value imports to `import type` therefore break
 * validation — and break it silently, because the pipe then sees `Object`,
 * finds no constraints, and lets everything through.
 *
 * Naming the type here removes that trap entirely: the DTO is used as a value,
 * so no rewrite is possible, and the route says out loud what it validates.
 */
export function validated(dto: Type<unknown>): PipeTransform {
  return new ValidationPipe({
    expectedType: dto,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
