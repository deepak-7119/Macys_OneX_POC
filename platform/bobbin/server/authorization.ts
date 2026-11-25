import type { FastifyRequest } from 'fastify';
import type { Session } from '../../contracts/index.ts';
import { RuntimeError } from './errors.ts';

export function requireCapability(request: FastifyRequest, capability: string): Session {
  const session = request.syntheticSession;
  if (!session || !session.capabilities.includes(capability)) {
    throw new RuntimeError(
      403,
      'FORBIDDEN',
      'This synthetic profile cannot access that capability.',
    );
  }
  return session;
}

export function requireDivision(session: Session, division: string) {
  if (session.division !== division) {
    throw new RuntimeError(
      403,
      'DIVISION_FORBIDDEN',
      'This synthetic profile cannot access that division.',
    );
  }
}
