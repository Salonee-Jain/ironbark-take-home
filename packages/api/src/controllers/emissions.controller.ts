import type { FastifyRequest } from 'fastify';
import * as service from '../services/emissions.service.js';

/**
 * Controllers own the HTTP boundary and nothing else: pull values off the
 * request, call a service, return the body.
 *
 * Where an endpoint takes no input there is nothing to map, so the service
 * function is exported directly rather than wrapped in a function that only
 * forwards its arguments. The seam still exists — anything needing request
 * context later (auth, tenant scoping, pagination headers) becomes a real
 * function here without touching routes or services.
 *
 * Errors are thrown, never formatted here: the error middleware is the single
 * place that decides what a failure looks like on the wire.
 */

type MonthRangeQuery = { from?: string; to?: string };

export const getMonthly = (
  request: FastifyRequest<{ Querystring: MonthRangeQuery }>,
) => service.getMonthlyEmissions(request.query);

export const getBreakdown = service.getActivityBreakdown;
export const getBySiteArea = service.getScope1BySiteArea;
export const getSummary = service.getSummary;
