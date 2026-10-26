import { BadRequestException } from '@nestjs/common';

export function assertTransition<S extends string>(map: Record<string, S[]>, from: S, to: S) {
  if (!(map[from] ?? []).includes(to)) {
    throw new BadRequestException(`Cannot move from ${from} to ${to}`);
  }
}

export const APPOINTMENT_DOCTOR_FLOW: Record<string, string[]> = {
  CONFIRMED: ['IN_QUEUE', 'NO_SHOW', 'COMPLETED'],
  IN_QUEUE: ['COMPLETED', 'NO_SHOW'],
};

export const LAB_FLOW: Record<string, string[]> = {
  CONFIRMED: ['SAMPLE_COLLECTED'],
  SAMPLE_COLLECTED: ['REPORT_UPLOADED'],
  REPORT_UPLOADED: ['COMPLETED'],
};

export const PHARMA_FLOW: Record<string, string[]> = {
  paid: ['ready'],
  ready: ['completed'],
};
