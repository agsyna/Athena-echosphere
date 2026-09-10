import assert from 'node:assert/strict';
import { answerCatchup } from '../src/catchup/answer.ts';
import {
  addParticipant,
  AGENT_UID,
  appendTranscript,
  createSession,
} from '../src/state/sessionRegistry.ts';
import { seedUnlikeFractionsLesson } from '../src/lesson/demoUnlikeFractions.ts';

let pass = 0;
const t = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
};

await t('supports teachers as pedagogical copilot', async () => {
  const session = createSession('Catch-up test');
  const teacher = addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  const result = await answerCatchup(session, teacher.participantId, 'Suggest a check-in question for fractions');
  assert.ok(result.reply.length > 10, result.reply);
  assert.equal(result.history[0]?.role, 'teacher');
  assert.equal(result.history[1]?.role, 'athena');
});

await t('recaps a missed lesson from notes and transcript', async () => {
  const session = createSession('Adding unlike fractions');
  seedUnlikeFractionsLesson(session.lesson);
  addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  appendTranscript(session, {
    participantId: null,
    uid: AGENT_UID,
    speaker: 'agent',
    text: 'The LCD of 2 and 3 is 6.',
    at: Date.now(),
  });

  const result = await answerCatchup(
    session,
    student.participantId,
    'I missed the start — what did we cover?',
  );
  assert.ok(result.reply.length > 20, result.reply);
  assert.ok(
    /LCD|denominator|fraction|6/i.test(result.reply),
    result.reply,
  );
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0]?.role, 'student');
  assert.equal(result.history[1]?.role, 'athena');
  assert.ok(result.sources.some((s) => s.kind === 'lesson' || s.kind === 'transcript'));
});

await t('keeps the thread on a second question', async () => {
  const session = createSession('Adding unlike fractions');
  seedUnlikeFractionsLesson(session.lesson);
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  await answerCatchup(session, student.participantId, 'What is the LCD rule?');
  const second = await answerCatchup(session, student.participantId, 'Give the 1/2 plus 1/3 example');
  assert.equal(second.history.length, 4);
  assert.match(second.reply, /6|LCD|1\/2|fraction/i);
});

// The bug this suite exists to hold shut: a class seeded with the demo
// fractions lesson but actually spent discussing photosynthesis used to come
// back as a confident recap of fractions, because `retrieveSync` never returns
// empty and the seeded document was labelled "live class record".
await t('a student recap reports the transcript, not the seeded lesson', async () => {
  const session = createSession('Adding unlike fractions');
  seedUnlikeFractionsLesson(session.lesson);
  addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  for (const text of [
    'Today we are talking about photosynthesis.',
    'Plants take in carbon dioxide and water and use sunlight to make glucose.',
    'The green pigment that captures the light is called chlorophyll.',
  ]) {
    appendTranscript(session, {
      participantId: null,
      uid: AGENT_UID,
      speaker: 'teacher',
      text,
      at: Date.now(),
    });
  }

  const result = await answerCatchup(session, student.participantId, 'What did the teacher just say?');
  assert.ok(/photosynth|chlorophyll|glucose|sunlight|plant/i.test(result.reply), result.reply);
  assert.ok(
    !/\b(LCD|denominator|numerator|unlike fractions)\b/i.test(result.reply),
    `leaked the seeded lesson: ${result.reply}`,
  );
  assert.ok(
    result.sources.every((s) => s.kind === 'transcript'),
    `student grounded in non-transcript sources: ${JSON.stringify(result.sources)}`,
  );
});

await t('a student question off this subject is declined', async () => {
  const session = createSession('Adding unlike fractions');
  seedUnlikeFractionsLesson(session.lesson);
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  appendTranscript(session, {
    participantId: null,
    uid: AGENT_UID,
    speaker: 'teacher',
    text: 'To add 2/5 and 1/10, first find the LCD of 5 and 10.',
    at: Date.now(),
  });

  const result = await answerCatchup(session, student.participantId, 'Who wrote Romeo and Juliet?');
  assert.ok(!/shakespeare/i.test(result.reply), `answered off-subject: ${result.reply}`);
});

await t('a topic-related question absent from the transcript is still answered', async () => {
  const session = createSession('Adding unlike fractions');
  const student = addParticipant(session, { displayName: 'Ana', role: 'student' });
  appendTranscript(session, {
    participantId: null,
    uid: AGENT_UID,
    speaker: 'teacher',
    text: 'Remember, never add the denominators straight across.',
    at: Date.now(),
  });

  const result = await answerCatchup(session, student.participantId, 'How do I add 1/3 and 1/6?');
  assert.ok(result.reply.length > 20, result.reply);
  assert.match(result.reply, /1\/2|3\/6|sixth|LCD|denominator/i);
});

await t('a teacher keeps lesson documents in their grounding', async () => {
  const session = createSession('Adding unlike fractions');
  seedUnlikeFractionsLesson(session.lesson);
  const teacher = addParticipant(session, { displayName: 'Ms Rao', role: 'teacher' });
  const result = await answerCatchup(session, teacher.participantId, 'Give me a board challenge problem');
  assert.ok(
    result.sources.some((s) => s.kind === 'lesson'),
    `teacher lost lesson grounding: ${JSON.stringify(result.sources)}`,
  );
});

console.log(`\n${pass} passing`);
if (process.exitCode) process.exit(process.exitCode);
