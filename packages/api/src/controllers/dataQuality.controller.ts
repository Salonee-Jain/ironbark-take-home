import type { FastifyRequest } from 'fastify';
import * as service from '../services/dataQuality.service.js';
import type { IssueQuery } from '../services/dataQuality.service.js';

export const getOverview = service.getOverview;

export const listIssues = (
  request: FastifyRequest<{ Querystring: IssueQuery }>,
) => service.listIssues(request.query);

export const listRules = service.listRules;
