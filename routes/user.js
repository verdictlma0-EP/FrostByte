const express = require('express');
const admin   = require('../config/firebase');

const router = express.Router();
const db     = admin.database();
const auth   = admin.auth();

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = await auth.verifyIdToken(token);
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid token: ' + e.message });
  }
}

router.get('/profile/:uid', verifyToken, async (req, res) => {
  try {
    const snap = await db.ref(`users/${req.params.uid}`).once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'User not found' });
    res.json(snap.val());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/profile', verifyToken, async (req, res) => {
  const uid     = req.user.uid;
  const allowed = ['username','bio','avatar','banner'];
  const update  = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  }
  update.updatedAt = Date.now();
  try {
    await db.ref(`users/${uid}`).update(update);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const OWNER_EMAILS = (process.env.OWNER_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

router.get('/list', verifyToken, async (req, res) => {
  if (!OWNER_EMAILS.includes((req.user.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const snap = await db.ref('users').limitToFirst(100).once('value');
    res.json(snap.val() || {});
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:uid', verifyToken, async (req, res) => {
  if (!OWNER_EMAILS.includes((req.user.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await auth.deleteUser(req.params.uid);
    await db.ref(`users/${req.params.uid}`).remove();
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
