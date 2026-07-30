import type { FastifyInstance } from 'fastify';
import { JWT_COOKIE_NAME } from '../../shared/constants/index.js';
import {
  authenticate,
  changePassword,
  getSafeUserById,
  updateUserPreferences,
  verifyPassword,
  findUserById,
} from './auth.service.js';
import { writeAudit } from '../audit/audit.service.js';

interface LoginBody {
  username?: string;
  password?: string;
}

interface PrefsBody {
  language?: string;
  theme?: string;
}

interface ChangePasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  app.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const { username, password } = request.body ?? {};

    if (!username || !password) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Kullanıcı adı ve şifre gereklidir',
      });
    }

    const user = authenticate(username, password);
    if (!user) {
      writeAudit({
        username,
        action: 'login_failed',
        entityType: 'auth',
        ipAddress: request.ip,
      });
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Kullanıcı adı veya şifre hatalı',
      });
    }

    const token = app.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    reply.setCookie(JWT_COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // air-gapped lokal ağ — HTTPS yok
      maxAge: 12 * 60 * 60, // 12 saat (saniye)
    });

    writeAudit({
      userId: user.id,
      username: user.username,
      action: 'login',
      entityType: 'auth',
      ipAddress: request.ip,
    });

    return { user, token };
  });

  // POST /api/auth/logout
  app.post('/logout', { preHandler: [app.authenticate] }, async (request, reply) => {
    reply.clearCookie(JWT_COOKIE_NAME, { path: '/' });

    writeAudit({
      userId: request.user.sub,
      username: request.user.username,
      action: 'logout',
      entityType: 'auth',
      ipAddress: request.ip,
    });

    return { success: true };
  });

  // GET /api/auth/me
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getSafeUserById(request.user.sub);
    if (!user) {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Kullanıcı bulunamadı veya devre dışı',
      });
    }
    return { user };
  });

  // POST /api/auth/ws-token — geçerli oturum (httpOnly cookie) için taze JWT üretir.
  // Sayfa yenilemesinde bellekteki token kaybolduğundan, oturum geri yükleme
  // akışı WebSocket bağlantısını bu endpoint ile kurar.
  app.post('/ws-token', { preHandler: [app.authenticate] }, async (request) => {
    const token = app.jwt.sign({
      sub: request.user.sub,
      username: request.user.username,
      role: request.user.role,
    });
    return { token };
  });

  // PUT /api/auth/preferences — dil/tema tercihi
  app.put<{ Body: PrefsBody }>(
    '/preferences',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { language, theme } = request.body ?? {};

      if (language !== undefined && !['tr', 'en'].includes(language)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Geçersiz dil değeri',
        });
      }
      if (theme !== undefined && !['dark', 'light'].includes(theme)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Geçersiz tema değeri',
        });
      }

      updateUserPreferences(request.user.sub, { language, theme });
      return { success: true };
    }
  );

  // PUT /api/auth/password — şifre değiştirme
  app.put<{ Body: ChangePasswordBody }>(
    '/password',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body ?? {};

      if (!currentPassword || !newPassword) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Mevcut şifre ve yeni şifre gereklidir',
        });
      }
      if (newPassword.length < 4) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Yeni şifre en az 4 karakter olmalıdır',
        });
      }

      const userRow = findUserById(request.user.sub);
      if (!userRow || !verifyPassword(currentPassword, userRow.password_hash)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Mevcut şifre hatalı',
        });
      }

      changePassword(request.user.sub, newPassword);

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'update',
        entityType: 'user',
        entityId: String(request.user.sub),
        details: { field: 'password' },
        ipAddress: request.ip,
      });

      return { success: true };
    }
  );
}