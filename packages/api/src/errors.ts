/**
 * Application errors.
 *
 * Services throw these; the error middleware turns them into responses. That
 * keeps HTTP concerns out of the service layer — a service should be able to
 * say "that incident does not exist" without knowing what a 404 is.
 */

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, hint?: string) {
    super(404, 'not_found', message, hint);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, hint?: string) {
    super(503, 'service_unavailable', message, hint);
  }
}
