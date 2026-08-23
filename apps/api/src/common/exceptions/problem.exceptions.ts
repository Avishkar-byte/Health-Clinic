import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Typed problem exceptions that carry machine-readable codes.
 * The ProblemExceptionFilter serialises these to RFC 7807.
 */
export class ProblemException extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    title: string,
    detail?: string,
    extra?: Record<string, unknown>,
  ) {
    super({ code, title, detail, ...extra }, status);
  }
}

export class SlotUnavailableException extends ProblemException {
  constructor(alternatives?: unknown[]) {
    super(
      HttpStatus.CONFLICT,
      'SLOT_UNAVAILABLE',
      'This slot is no longer available',
      'The slot was taken or is on leave. Try one of the alternatives.',
      alternatives ? { alternatives } : undefined,
    );
  }
}

export class HoldExpiredException extends ProblemException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'HOLD_EXPIRED',
      'Hold expired',
      'Your 10-minute hold on this slot has expired. The slot is open again — pick another time.',
    );
  }
}

export class DoctorOnLeaveException extends ProblemException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'DOCTOR_ON_LEAVE',
      'Doctor is on leave',
      'The doctor has marked this period as leave. Please choose another time.',
    );
  }
}

export class SlotConflictException extends ProblemException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'SLOT_CONFLICT',
      'This slot was just booked',
      'Someone else booked this slot moments before you. Please pick another time.',
    );
  }
}

export class IdempotencyConflictException extends ProblemException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'IDEMPOTENCY_CONFLICT',
      'Duplicate request',
      'A request with this Idempotency-Key was already processed with different parameters.',
    );
  }
}
