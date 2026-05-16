const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const calendarController = require('../controllers/calendar.controller');

router.use(authenticate);

router.get('/events', calendarController.getEvents);
router.post('/events', calendarController.createEvent);
router.put('/events/:id', calendarController.updateEvent);
router.delete('/events/:id', calendarController.deleteEvent);

module.exports = router;
