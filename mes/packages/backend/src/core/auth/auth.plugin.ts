import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { JWT_COOKIE_NAME, JWT_EXPIRES_IN } from '../../shared/constants/index.js';
import type { JwtPayload, Role } from '../../shared/types/index.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      roles: Role[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Auth plugin: JWT (httpOnly cookie + Authorization header) doğrulaması sağlar.
 * - authenticate: request.user doldurur, geçersizse 401
 * - requireRole(['admin']): rol bazlı yetki kontrolü, yetersizse 403
 */
async function authPlugin(app: FastifyInstance): Promise<void> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  await app.register(fastifyCookie);

  await app.register(fastifyJwt, {
    secret,
    cookie: {
      cookieName: JWT_COOKIE_NAME,
      signed: false,
    },
    sign: {
      expiresIn: JWT_EXPIRES_IN,
    },
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Geçerli bir oturum bulunamadı',
      });
    }
  });

  app.decorate('requireRole', (roles: Role[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Geçerli bir oturum bulunamadı',
        });
      }
      if (!roles.includes(request.user.role)) {
        return reply.code(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Bu işlem için yetkiniz bulunmuyor',
        });
      }
    };
  });
}

export default fp(authPlugin, { name: 'auth' });