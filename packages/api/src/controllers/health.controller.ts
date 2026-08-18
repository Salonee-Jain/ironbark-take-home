import * as service from '../services/health.service.js';

// Failure throws ServiceUnavailableError and the middleware renders the 503.
export const getHealth = service.getHealth;
