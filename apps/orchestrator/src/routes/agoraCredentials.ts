/**
 * A signed-in teacher's own Agora project — see agora/credentials.ts.
 *
 * These routes use `authenticate` directly rather than `requireTeacher`: the
 * latter lets anonymous callers through while AUTH_REQUIRED is off, which is
 * right for creating a lesson but meaningless here, since there is no account
 * to save credentials against. An anonymous teacher's path is the `agora`
 * field on POST /api/sessions instead.
 *
 * The certificate never comes back out: GET reports the App ID and whether a
 * certificate is on file, nothing more.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/supabaseAuth.js';
import {
  AgoraCredentialError,
  clearTeacherCredentials,
  saveTeacherCredentials,
  teacherCredentialStatus,
} from '../agora/credentials.js';

const saveSchema = z.object({
  appId: z.string().min(1).max(64),
  appCertificate: z.string().min(1).max(64),
});

export async function agoraCredentialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me/agora-credentials', async (request, reply) => {
    const teacher = await authenticate(request);
    if (!teacher) {
      return reply.code(401).send({ error: 'Sign in to manage your Agora credentials.' });
    }
    return reply.send(await teacherCredentialStatus(teacher.userId));
  });

  app.put('/api/me/agora-credentials', async (request, reply) => {
    const teacher = await authenticate(request);
    if (!teacher) {
      return reply.code(401).send({ error: 'Sign in to manage your Agora credentials.' });
    }
    const body = saveSchema.parse(request.body);
    try {
      return reply.send(await saveTeacherCredentials(teacher, body));
    } catch (error) {
      if (error instanceof AgoraCredentialError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  app.delete('/api/me/agora-credentials', async (request, reply) => {
    const teacher = await authenticate(request);
    if (!teacher) {
      return reply.code(401).send({ error: 'Sign in to manage your Agora credentials.' });
    }
    await clearTeacherCredentials(teacher.userId);
    return reply.send(await teacherCredentialStatus(teacher.userId));
  });
}
