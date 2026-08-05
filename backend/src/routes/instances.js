const express = require('express');
const { requireAuth } = require('../middleware/auth');
const instanceService = require('../services/instanceService');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    res.json({ instances: await instanceService.listInstances(req.user.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json({ instance: await instanceService.createInstance(req.user.id) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const instance = await instanceService.getInstanceForUser(req.user.id, req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    res.json({ instance });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const instance = await instanceService.terminateInstance(req.user.id, req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    res.status(202).json({ instance });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
