import type { FastifyRequest } from 'fastify';
import * as service from '../services/incidents.service.js';
import type { IncidentQuery } from '../services/incidents.service.js';

export const listIncidents = (
  request: FastifyRequest<{ Querystring: IncidentQuery }>,
) => service.listIncidents(request.query);

export const getTrends = service.getTrends;

// A missing incident throws NotFoundError from the service and the error
// middleware renders the 404; the controller does not need to know that.
export const getIncidentDetail = (
  request: FastifyRequest<{ Params: { id: string } }>,
) => service.getIncidentDetail(request.params.id);
