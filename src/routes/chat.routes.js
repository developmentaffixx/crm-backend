const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const chatCtrl = require('../controllers/chat.controller');

// All routes require authentication
router.use(authenticate);

// Conversations
router.get('/conversations', chatCtrl.getConversations);
router.post('/conversations', chatCtrl.createConversation);
router.get('/conversations/:conversationId', chatCtrl.getConversationDetails);
router.put('/conversations/:conversationId/read', chatCtrl.markAsRead);
router.get('/conversations/:conversationId/read-receipts', chatCtrl.getReadReceipts);
router.get('/conversations/:conversationId/media', chatCtrl.getSharedMedia);
router.get('/conversations/:conversationId/search', chatCtrl.searchMessages);

// Group member management
router.post('/conversations/:conversationId/members', chatCtrl.addMembers);
router.delete('/conversations/:conversationId/members/:memberId', chatCtrl.removeMember);

// Messages
router.get('/conversations/:conversationId/messages', chatCtrl.getMessages);
router.post('/conversations/:conversationId/messages', chatCtrl.uploadMiddleware, chatCtrl.sendMessage);
router.put('/messages/:messageId', chatCtrl.editMessage);
router.delete('/messages/:messageId', chatCtrl.deleteMessage);
router.post('/messages/:messageId/forward', chatCtrl.forwardMessage);
router.post('/messages/:messageId/reactions', chatCtrl.toggleReaction);

// Polls
router.post('/conversations/:conversationId/polls', chatCtrl.createPoll);
router.post('/polls/:pollId/vote', chatCtrl.votePoll);

// Users
router.get('/users', chatCtrl.searchUsers);
router.get('/online', chatCtrl.getOnlineUsers);
router.get('/unread-count', chatCtrl.getUnreadCount);

module.exports = router;
