const db = require('../config/db');
const { emitEvent } = require('../config/socket');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─── File upload config ───────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/chat');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar|csv|mp4|mp3/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    cb(ext ? null : new Error('File type not allowed'), ext);
  },
});

exports.uploadMiddleware = upload.single('file');


// ─── Auto-create chat tables if they don't exist ──────────────────────────────
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        type        ENUM('direct', 'group') NOT NULL DEFAULT 'direct',
        name        VARCHAR(255) DEFAULT NULL,
        description TEXT DEFAULT NULL,
        avatar_url  VARCHAR(500) DEFAULT NULL,
        created_by  INT UNSIGNED NOT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_conv_creator FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversation_members (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT UNSIGNED NOT NULL,
        user_id         INT UNSIGNED NOT NULL,
        role            ENUM('admin', 'member') NOT NULL DEFAULT 'member',
        joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_read_at    DATETIME DEFAULT NULL,
        UNIQUE KEY uq_conv_member (conversation_id, user_id),
        CONSTRAINT fk_cm_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        CONSTRAINT fk_cm_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT UNSIGNED NOT NULL,
        sender_id       INT UNSIGNED NOT NULL,
        content         TEXT NOT NULL,
        message_type    ENUM('text', 'image', 'file', 'system', 'poll') NOT NULL DEFAULT 'text',
        file_url        VARCHAR(500) DEFAULT NULL,
        file_name       VARCHAR(255) DEFAULT NULL,
        file_size       INT UNSIGNED DEFAULT NULL,
        reply_to_id     INT UNSIGNED DEFAULT NULL,
        forwarded_from_id INT UNSIGNED DEFAULT NULL,
        is_edited       TINYINT(1) NOT NULL DEFAULT 0,
        deleted         TINYINT(1) NOT NULL DEFAULT 0,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_msg_conv   FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id),
        CONSTRAINT fk_msg_reply  FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL,
        INDEX idx_msg_conv_created (conversation_id, created_at)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS message_reads (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        message_id INT UNSIGNED NOT NULL,
        user_id    INT UNSIGNED NOT NULL,
        read_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_msg_read (message_id, user_id),
        CONSTRAINT fk_mr_msg  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_mr_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        message_id INT UNSIGNED NOT NULL,
        user_id    INT UNSIGNED NOT NULL,
        emoji      VARCHAR(10) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_msg_reaction (message_id, user_id, emoji),
        CONSTRAINT fk_react_msg  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_react_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    // Add columns if they don't exist (safe for existing installs)
    try { await db.query('ALTER TABLE messages ADD COLUMN file_size INT UNSIGNED DEFAULT NULL AFTER file_name'); } catch(e) {}
    try { await db.query('ALTER TABLE messages ADD COLUMN forwarded_from_id INT UNSIGNED DEFAULT NULL AFTER reply_to_id'); } catch(e) {}
    // V3: Polls tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_polls (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        message_id      INT UNSIGNED NOT NULL,
        conversation_id INT UNSIGNED NOT NULL,
        question        VARCHAR(500) NOT NULL,
        allow_multiple  TINYINT(1) NOT NULL DEFAULT 0,
        created_by      INT UNSIGNED NOT NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_poll_msg  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_poll_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        CONSTRAINT fk_poll_user FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_poll_options (
        id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        poll_id INT UNSIGNED NOT NULL,
        text    VARCHAR(255) NOT NULL,
        CONSTRAINT fk_opt_poll FOREIGN KEY (poll_id) REFERENCES chat_polls(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_poll_votes (
        id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        poll_id   INT UNSIGNED NOT NULL,
        option_id INT UNSIGNED NOT NULL,
        user_id   INT UNSIGNED NOT NULL,
        voted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_poll_vote (poll_id, option_id, user_id),
        CONSTRAINT fk_vote_poll FOREIGN KEY (poll_id) REFERENCES chat_polls(id) ON DELETE CASCADE,
        CONSTRAINT fk_vote_opt  FOREIGN KEY (option_id) REFERENCES chat_poll_options(id) ON DELETE CASCADE,
        CONSTRAINT fk_vote_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    // V3: Delete for me table
    await db.query(`
      CREATE TABLE IF NOT EXISTS message_deletions (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        message_id INT UNSIGNED NOT NULL,
        user_id    INT UNSIGNED NOT NULL,
        deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_msg_del (message_id, user_id),
        CONSTRAINT fk_mdel_msg  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_mdel_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    // Alter message_type to include 'poll'
    try { await db.query("ALTER TABLE messages MODIFY COLUMN message_type ENUM('text', 'image', 'file', 'system', 'poll') NOT NULL DEFAULT 'text'"); } catch(e) {}
    console.log('✅ Chat tables ready (v3)');
  } catch (err) {
    console.error('⚠️  Chat table migration error:', err.message);
  }
})();


// ─── Get all conversations for the current user ───────────────────────────────
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { filter } = req.query; // 'all', 'unread', 'groups'

    let filterClause = '';
    if (filter === 'unread') {
      filterClause = `HAVING unread_count > 0`;
    } else if (filter === 'groups') {
      filterClause = `AND c.type = 'group'`;
    }

    const [rows] = await db.query(`
      SELECT 
        c.id, c.type, c.name, c.description, c.avatar_url, c.created_by, c.created_at,
        cm.last_read_at,
        (
          SELECT JSON_OBJECT(
            'id', m.id, 'content', m.content, 'message_type', m.message_type,
            'sender_id', m.sender_id, 'created_at', m.created_at,
            'sender_name', CONCAT(u2.first_name, ' ', u2.last_name)
          )
          FROM messages m
          JOIN users u2 ON u2.id = m.sender_id
          WHERE m.conversation_id = c.id AND m.deleted = 0
          ORDER BY m.created_at DESC LIMIT 1
        ) AS last_message,
        (
          SELECT COUNT(*)
          FROM messages m2
          WHERE m2.conversation_id = c.id 
            AND m2.deleted = 0
            AND m2.sender_id != ?
            AND m2.created_at > COALESCE(cm.last_read_at, '1970-01-01')
        ) AS unread_count
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
      ${filter === 'groups' ? "WHERE c.type = 'group'" : ''}
      ORDER BY (
        SELECT MAX(m3.created_at) FROM messages m3 WHERE m3.conversation_id = c.id AND m3.deleted = 0
      ) DESC, c.created_at DESC
    `, [userId, userId]);

    // Filter unread after query (HAVING not supported in subquery context)
    let filteredRows = rows;
    if (filter === 'unread') {
      filteredRows = rows.filter(r => r.unread_count > 0);
    }

    const conversationsWithMembers = await Promise.all(filteredRows.map(async (conv) => {
      const [members] = await db.query(`
        SELECT u.id, u.first_name, u.last_name, u.email, u.is_active, u.avatar_url
        FROM conversation_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ?
      `, [conv.id]);

      let parsedLastMessage = conv.last_message;
      if (typeof parsedLastMessage === 'string') {
        try { parsedLastMessage = JSON.parse(parsedLastMessage); } catch (e) { parsedLastMessage = null; }
      }

      return {
        ...conv,
        last_message: parsedLastMessage,
        members,
        other_user: conv.type === 'direct' ? members.find(m => m.id !== userId) : null,
      };
    }));

    res.json(conversationsWithMembers);
  } catch (err) {
    console.error('getConversations error:', err);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
};


// ─── Create a new conversation (direct or group) ──────────────────────────────
exports.createConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = 'direct', name, description, member_ids = [] } = req.body;

    if (type === 'direct' && member_ids.length !== 1) {
      return res.status(400).json({ message: 'Direct chat requires exactly one other member' });
    }
    if (type === 'group' && member_ids.length === 0) {
      return res.status(400).json({ message: 'Group chat requires at least one member' });
    }
    if (type === 'group' && !name) {
      return res.status(400).json({ message: 'Group chat requires a name' });
    }

    if (type === 'direct') {
      const otherUserId = member_ids[0];
      const [existing] = await db.query(`
        SELECT c.id FROM conversations c
        JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
        JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
        WHERE c.type = 'direct'
        LIMIT 1
      `, [userId, otherUserId]);

      if (existing.length > 0) {
        return res.json({ id: existing[0].id, existing: true });
      }
    }

    const [result] = await db.query(
      'INSERT INTO conversations (type, name, description, created_by) VALUES (?, ?, ?, ?)',
      [type, name || null, description || null, userId]
    );
    const conversationId = result.insertId;

    await db.query(
      'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
      [conversationId, userId, 'admin']
    );

    for (const memberId of member_ids) {
      if (Number(memberId) !== Number(userId)) {
        await db.query(
          'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
          [conversationId, Number(memberId), 'member']
        );
      }
    }

    for (const memberId of member_ids) {
      emitEvent('chat:conversation-created', { conversationId }, `user:${memberId}`);
    }

    res.status(201).json({ id: conversationId, existing: false });
  } catch (err) {
    console.error('createConversation error:', err.message, err.stack);
    res.status(500).json({ message: 'Failed to create conversation', error: err.message });
  }
};


// ─── Get messages for a conversation (with pagination) ────────────────────────
exports.getMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const [membership] = await db.query(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this conversation' });
    }

    const [messages] = await db.query(`
      SELECT 
        m.id, m.conversation_id, m.sender_id, m.content, m.message_type,
        m.file_url, m.file_name, m.file_size, m.reply_to_id, m.forwarded_from_id,
        m.is_edited, m.created_at,
        u.first_name AS sender_first_name, u.last_name AS sender_last_name, u.email AS sender_email,
        rm.content AS reply_content, ru.first_name AS reply_sender_first_name, ru.last_name AS reply_sender_last_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      LEFT JOIN messages rm ON rm.id = m.reply_to_id
      LEFT JOIN users ru ON ru.id = rm.sender_id
      LEFT JOIN message_deletions md ON md.message_id = m.id AND md.user_id = ?
      WHERE m.conversation_id = ? AND m.deleted = 0 AND md.id IS NULL
      ORDER BY m.created_at ASC
      LIMIT ? OFFSET ?
    `, [userId, conversationId, parseInt(limit), parseInt(offset)]);

    // Get reactions for these messages
    if (messages.length > 0) {
      const msgIds = messages.map(m => m.id);
      const [reactions] = await db.query(`
        SELECT mr.message_id, mr.emoji, mr.user_id, u.first_name, u.last_name
        FROM message_reactions mr
        JOIN users u ON u.id = mr.user_id
        WHERE mr.message_id IN (?)
      `, [msgIds]);

      const reactionMap = {};
      for (const r of reactions) {
        if (!reactionMap[r.message_id]) reactionMap[r.message_id] = [];
        reactionMap[r.message_id].push(r);
      }
      for (const msg of messages) {
        msg.reactions = reactionMap[msg.id] || [];
      }

      // Get poll data for poll messages
      const pollMsgs = messages.filter(m => m.message_type === 'poll');
      if (pollMsgs.length > 0) {
        const pollMsgIds = pollMsgs.map(m => m.id);
        const [polls] = await db.query(`SELECT * FROM chat_polls WHERE message_id IN (?)`, [pollMsgIds]);
        if (polls.length > 0) {
          const pollIds = polls.map(p => p.id);
          const [options] = await db.query(`SELECT * FROM chat_poll_options WHERE poll_id IN (?)`, [pollIds]);
          const [votes] = await db.query(`
            SELECT v.poll_id, v.option_id, v.user_id, u.first_name, u.last_name
            FROM chat_poll_votes v JOIN users u ON u.id = v.user_id
            WHERE v.poll_id IN (?)
          `, [pollIds]);

          const pollMap = {};
          for (const poll of polls) {
            pollMap[poll.message_id] = {
              ...poll,
              options: options.filter(o => o.poll_id === poll.id).map(o => ({
                ...o,
                votes: votes.filter(v => v.option_id === o.id),
                vote_count: votes.filter(v => v.option_id === o.id).length,
              })),
              total_votes: votes.filter(v => v.poll_id === poll.id).length,
            };
          }
          for (const msg of messages) {
            if (msg.message_type === 'poll') {
              msg.poll = pollMap[msg.id] || null;
            }
          }
        }
      }
    }

    // Get total count for pagination
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) as total FROM messages WHERE conversation_id = ? AND deleted = 0',
      [conversationId]
    );

    await db.query(
      'UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );

    res.json({ messages, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('getMessages error:', err);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
};


// ─── Send a message ───────────────────────────────────────────────────────────
exports.sendMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { content, message_type = 'text', reply_to_id, forwarded_from_id } = req.body;

    const [membership] = await db.query(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this conversation' });
    }

    // Handle file upload
    let fileUrl = null, fileName = null, fileSize = null;
    if (req.file) {
      fileUrl = `/uploads/chat/${req.file.filename}`;
      fileName = req.file.originalname;
      fileSize = req.file.size;
    }

    const actualType = req.file
      ? (/\.(jpg|jpeg|png|gif|webp)$/i.test(req.file.originalname) ? 'image' : 'file')
      : message_type;

    const [result] = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type, file_url, file_name, file_size, reply_to_id, forwarded_from_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [conversationId, userId, content || fileName || '', actualType, fileUrl, fileName, fileSize, reply_to_id || null, forwarded_from_id || null]
    );

    const [[message]] = await db.query(`
      SELECT 
        m.id, m.conversation_id, m.sender_id, m.content, m.message_type,
        m.file_url, m.file_name, m.file_size, m.reply_to_id, m.forwarded_from_id, m.is_edited, m.created_at,
        u.first_name AS sender_first_name, u.last_name AS sender_last_name, u.email AS sender_email
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.id = ?
    `, [result.insertId]);

    message.reactions = [];

    await db.query(
      'UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );

    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?',
      [conversationId, userId]
    );

    for (const member of members) {
      emitEvent('chat:new-message', message, `user:${member.user_id}`);
    }
    emitEvent('chat:new-message', message, `user:${userId}`);

    res.status(201).json(message);
  } catch (err) {
    console.error('sendMessage error:', err);
    res.status(500).json({ message: 'Failed to send message' });
  }
};


// ─── Edit a message ───────────────────────────────────────────────────────────
exports.editMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Content is required' });
    }

    const [[message]] = await db.query(
      'SELECT id, conversation_id, sender_id, created_at FROM messages WHERE id = ? AND deleted = 0',
      [messageId]
    );

    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (message.sender_id !== userId) return res.status(403).json({ message: 'Can only edit your own messages' });

    // 15-minute edit window
    const diffMs = Date.now() - new Date(message.created_at).getTime();
    if (diffMs > 15 * 60 * 1000) {
      return res.status(400).json({ message: 'Edit window expired (15 minutes)' });
    }

    await db.query('UPDATE messages SET content = ?, is_edited = 1 WHERE id = ?', [content.trim(), messageId]);

    const [[updated]] = await db.query(`
      SELECT m.id, m.conversation_id, m.sender_id, m.content, m.is_edited, m.created_at,
        u.first_name AS sender_first_name, u.last_name AS sender_last_name
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
    `, [messageId]);

    // Notify all members
    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [message.conversation_id]
    );
    for (const member of members) {
      emitEvent('chat:message-edited', updated, `user:${member.user_id}`);
    }

    res.json(updated);
  } catch (err) {
    console.error('editMessage error:', err);
    res.status(500).json({ message: 'Failed to edit message' });
  }
};


// ─── Delete a message ─────────────────────────────────────────────────────────
exports.deleteMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { mode = 'everyone' } = req.body; // 'me' or 'everyone'

    const [[message]] = await db.query(
      'SELECT id, conversation_id, sender_id FROM messages WHERE id = ? AND deleted = 0',
      [messageId]
    );

    if (!message) return res.status(404).json({ message: 'Message not found' });

    if (mode === 'me') {
      // Delete for me only — insert into message_deletions
      await db.query(
        'INSERT IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)',
        [messageId, userId]
      );
      return res.json({ success: true, mode: 'me' });
    }

    // Delete for everyone — only sender or admin can do this
    if (message.sender_id !== userId && !req.user.is_admin) {
      return res.status(403).json({ message: 'Cannot delete this message for everyone' });
    }

    await db.query('UPDATE messages SET deleted = 1 WHERE id = ?', [messageId]);

    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [message.conversation_id]
    );
    for (const member of members) {
      emitEvent('chat:message-deleted', { messageId: parseInt(messageId), conversationId: message.conversation_id }, `user:${member.user_id}`);
    }

    res.json({ success: true, mode: 'everyone' });
  } catch (err) {
    console.error('deleteMessage error:', err);
    res.status(500).json({ message: 'Failed to delete message' });
  }
};


// ─── Forward a message to another conversation ────────────────────────────────
exports.forwardMessage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { conversation_ids } = req.body; // array of target conversation IDs

    if (!conversation_ids || !conversation_ids.length) {
      return res.status(400).json({ message: 'Target conversations required' });
    }

    const [[original]] = await db.query(
      'SELECT * FROM messages WHERE id = ? AND deleted = 0',
      [messageId]
    );
    if (!original) return res.status(404).json({ message: 'Message not found' });

    const forwarded = [];
    for (const convId of conversation_ids) {
      // Verify membership
      const [membership] = await db.query(
        'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
        [convId, userId]
      );
      if (membership.length === 0) continue;

      const [result] = await db.query(
        `INSERT INTO messages (conversation_id, sender_id, content, message_type, file_url, file_name, file_size, forwarded_from_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [convId, userId, original.content, original.message_type, original.file_url, original.file_name, original.file_size, original.id]
      );

      const [[msg]] = await db.query(`
        SELECT m.id, m.conversation_id, m.sender_id, m.content, m.message_type,
          m.file_url, m.file_name, m.file_size, m.forwarded_from_id, m.created_at,
          u.first_name AS sender_first_name, u.last_name AS sender_last_name
        FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
      `, [result.insertId]);

      msg.reactions = [];

      const [members] = await db.query(
        'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
        [convId]
      );
      for (const member of members) {
        emitEvent('chat:new-message', msg, `user:${member.user_id}`);
      }
      forwarded.push(msg);
    }

    res.json({ forwarded, count: forwarded.length });
  } catch (err) {
    console.error('forwardMessage error:', err);
    res.status(500).json({ message: 'Failed to forward message' });
  }
};


// ─── Add/Remove reaction ──────────────────────────────────────────────────────
exports.toggleReaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) return res.status(400).json({ message: 'Emoji is required' });

    const [[message]] = await db.query(
      'SELECT id, conversation_id FROM messages WHERE id = ? AND deleted = 0',
      [messageId]
    );
    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Check if reaction exists
    const [existing] = await db.query(
      'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [messageId, userId, emoji]
    );

    if (existing.length > 0) {
      await db.query('DELETE FROM message_reactions WHERE id = ?', [existing[0].id]);
    } else {
      await db.query(
        'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
        [messageId, userId, emoji]
      );
    }

    // Get updated reactions for this message
    const [reactions] = await db.query(`
      SELECT mr.emoji, mr.user_id, u.first_name, u.last_name
      FROM message_reactions mr JOIN users u ON u.id = mr.user_id
      WHERE mr.message_id = ?
    `, [messageId]);

    const payload = { messageId: parseInt(messageId), conversationId: message.conversation_id, reactions };

    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [message.conversation_id]
    );
    for (const member of members) {
      emitEvent('chat:reaction-updated', payload, `user:${member.user_id}`);
    }

    res.json(payload);
  } catch (err) {
    console.error('toggleReaction error:', err);
    res.status(500).json({ message: 'Failed to toggle reaction' });
  }
};


// ─── Search messages within a conversation ────────────────────────────────────
exports.searchMessages = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { q } = req.query;

    if (!q || !q.trim()) return res.json([]);

    const [membership] = await db.query(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this conversation' });
    }

    const [messages] = await db.query(`
      SELECT m.id, m.content, m.created_at, m.sender_id,
        u.first_name AS sender_first_name, u.last_name AS sender_last_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? AND m.deleted = 0 AND m.content LIKE ?
      ORDER BY m.created_at DESC
      LIMIT 50
    `, [conversationId, `%${q.trim()}%`]);

    res.json(messages);
  } catch (err) {
    console.error('searchMessages error:', err);
    res.status(500).json({ message: 'Failed to search messages' });
  }
};

// ─── Mark conversation as read ────────────────────────────────────────────────
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    await db.query(
      'UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );

    // Emit read receipt to other members
    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?',
      [conversationId, userId]
    );
    for (const member of members) {
      emitEvent('chat:read-receipt', { conversationId: parseInt(conversationId), userId, readAt: new Date().toISOString() }, `user:${member.user_id}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('markAsRead error:', err);
    res.status(500).json({ message: 'Failed to mark as read' });
  }
};


// ─── Get conversation details (members, info) ─────────────────────────────────
exports.getConversationDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const [membership] = await db.query(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this conversation' });
    }

    const [[conversation]] = await db.query('SELECT * FROM conversations WHERE id = ?', [conversationId]);

    const [members] = await db.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.is_active, u.avatar_url, cm.role, cm.joined_at, cm.last_read_at
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
    `, [conversationId]);

    // Get shared media count
    const [[mediaCount]] = await db.query(
      "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND deleted = 0 AND message_type = 'image'",
      [conversationId]
    );
    const [[fileCount]] = await db.query(
      "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND deleted = 0 AND message_type = 'file'",
      [conversationId]
    );

    res.json({ ...conversation, members, media_count: mediaCount.count, file_count: fileCount.count });
  } catch (err) {
    console.error('getConversationDetails error:', err);
    res.status(500).json({ message: 'Failed to fetch conversation details' });
  }
};

// ─── Get shared media/files for a conversation ────────────────────────────────
exports.getSharedMedia = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { type = 'image' } = req.query; // 'image' or 'file'

    const [membership] = await db.query(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member' });
    }

    const [files] = await db.query(`
      SELECT m.id, m.file_url, m.file_name, m.file_size, m.message_type, m.created_at,
        u.first_name AS sender_first_name, u.last_name AS sender_last_name
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? AND m.deleted = 0 AND m.message_type = ?
      ORDER BY m.created_at DESC LIMIT 100
    `, [conversationId, type]);

    res.json(files);
  } catch (err) {
    console.error('getSharedMedia error:', err);
    res.status(500).json({ message: 'Failed to fetch shared media' });
  }
};


// ─── Search users to start a conversation ─────────────────────────────────────
exports.searchUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { q = '' } = req.query;

    const [users] = await db.query(`
      SELECT id, first_name, last_name, email, is_active, avatar_url
      FROM users
      WHERE id != ? AND deleted = 0 AND is_active = 1
        AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)
      ORDER BY first_name, last_name
      LIMIT 20
    `, [userId, `%${q}%`, `%${q}%`, `%${q}%`]);

    res.json(users);
  } catch (err) {
    console.error('searchUsers error:', err);
    res.status(500).json({ message: 'Failed to search users' });
  }
};

// ─── Get online users ─────────────────────────────────────────────────────────
exports.getOnlineUsers = async (req, res) => {
  try {
    const { getIO } = require('../config/socket');
    const io = getIO();
    const sockets = await io.fetchSockets();
    
    const onlineUserIds = new Set();
    for (const s of sockets) {
      for (const room of s.rooms) {
        if (room.startsWith('user:')) {
          onlineUserIds.add(parseInt(room.split(':')[1]));
        }
      }
    }

    res.json([...onlineUserIds]);
  } catch (err) {
    console.error('getOnlineUsers error:', err);
    res.json([]);
  }
};

// ─── Get total unread message count ───────────────────────────────────────────
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const [[result]] = await db.query(`
      SELECT COALESCE(SUM(unread), 0) AS total_unread FROM (
        SELECT COUNT(*) AS unread
        FROM messages m
        JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
        WHERE m.deleted = 0
          AND m.sender_id != ?
          AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01')
      ) AS counts
    `, [userId, userId]);

    res.json({ count: result.total_unread });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    res.json({ count: 0 });
  }
};

// ─── Get read receipts for a conversation (who read what) ─────────────────────
exports.getReadReceipts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const [membership] = await db.query(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member' });
    }

    const [receipts] = await db.query(`
      SELECT cm.user_id, cm.last_read_at, u.first_name, u.last_name
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ? AND cm.user_id != ?
    `, [conversationId, userId]);

    res.json(receipts);
  } catch (err) {
    console.error('getReadReceipts error:', err);
    res.status(500).json({ message: 'Failed to fetch read receipts' });
  }
};


// ─── Create a poll ────────────────────────────────────────────────────────────
exports.createPoll = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { question, options, allow_multiple = false } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ message: 'Question is required' });
    }
    if (!options || options.length < 2) {
      return res.status(400).json({ message: 'At least 2 options are required' });
    }
    if (options.length > 10) {
      return res.status(400).json({ message: 'Maximum 10 options allowed' });
    }

    // Verify membership
    const [membership] = await db.query(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this conversation' });
    }

    // Create the message
    const [msgResult] = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type) VALUES (?, ?, ?, 'poll')`,
      [conversationId, userId, question.trim()]
    );
    const messageId = msgResult.insertId;

    // Create the poll
    const [pollResult] = await db.query(
      'INSERT INTO chat_polls (message_id, conversation_id, question, allow_multiple, created_by) VALUES (?, ?, ?, ?, ?)',
      [messageId, conversationId, question.trim(), allow_multiple ? 1 : 0, userId]
    );
    const pollId = pollResult.insertId;

    // Create options
    const createdOptions = [];
    for (const optText of options) {
      if (optText && optText.trim()) {
        const [optResult] = await db.query(
          'INSERT INTO chat_poll_options (poll_id, text) VALUES (?, ?)',
          [pollId, optText.trim()]
        );
        createdOptions.push({ id: optResult.insertId, poll_id: pollId, text: optText.trim(), votes: [], vote_count: 0 });
      }
    }

    // Fetch the full message
    const [[message]] = await db.query(`
      SELECT m.id, m.conversation_id, m.sender_id, m.content, m.message_type, m.created_at,
        u.first_name AS sender_first_name, u.last_name AS sender_last_name
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
    `, [messageId]);

    message.reactions = [];
    message.poll = {
      id: pollId,
      message_id: messageId,
      conversation_id: parseInt(conversationId),
      question: question.trim(),
      allow_multiple: allow_multiple ? 1 : 0,
      created_by: userId,
      options: createdOptions,
      total_votes: 0,
    };

    // Update last_read_at
    await db.query(
      'UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );

    // Notify members
    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [conversationId]
    );
    for (const member of members) {
      emitEvent('chat:new-message', message, `user:${member.user_id}`);
    }

    res.status(201).json(message);
  } catch (err) {
    console.error('createPoll error:', err);
    res.status(500).json({ message: 'Failed to create poll' });
  }
};


// ─── Vote on a poll ───────────────────────────────────────────────────────────
exports.votePoll = async (req, res) => {
  try {
    const userId = req.user.id;
    const { pollId } = req.params;
    const { option_id } = req.body;

    if (!option_id) {
      return res.status(400).json({ message: 'Option ID is required' });
    }

    // Get poll info
    const [[poll]] = await db.query('SELECT * FROM chat_polls WHERE id = ?', [pollId]);
    if (!poll) return res.status(404).json({ message: 'Poll not found' });

    // Verify membership
    const [membership] = await db.query(
      'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [poll.conversation_id, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ message: 'Not a member of this conversation' });
    }

    // Verify option belongs to this poll
    const [[option]] = await db.query(
      'SELECT id FROM chat_poll_options WHERE id = ? AND poll_id = ?',
      [option_id, pollId]
    );
    if (!option) return res.status(400).json({ message: 'Invalid option' });

    // Check if user already voted for this option (toggle)
    const [existingVote] = await db.query(
      'SELECT id FROM chat_poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?',
      [pollId, option_id, userId]
    );

    if (existingVote.length > 0) {
      // Remove vote (toggle off)
      await db.query('DELETE FROM chat_poll_votes WHERE id = ?', [existingVote[0].id]);
    } else {
      // If not allow_multiple, remove previous votes first
      if (!poll.allow_multiple) {
        await db.query('DELETE FROM chat_poll_votes WHERE poll_id = ? AND user_id = ?', [pollId, userId]);
      }
      // Add vote
      await db.query(
        'INSERT INTO chat_poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)',
        [pollId, option_id, userId]
      );
    }

    // Get updated poll data
    const [options] = await db.query('SELECT * FROM chat_poll_options WHERE poll_id = ?', [pollId]);
    const [votes] = await db.query(`
      SELECT v.poll_id, v.option_id, v.user_id, u.first_name, u.last_name
      FROM chat_poll_votes v JOIN users u ON u.id = v.user_id
      WHERE v.poll_id = ?
    `, [pollId]);

    const updatedPoll = {
      ...poll,
      options: options.map(o => ({
        ...o,
        votes: votes.filter(v => v.option_id === o.id),
        vote_count: votes.filter(v => v.option_id === o.id).length,
      })),
      total_votes: votes.length,
    };

    // Notify all members
    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [poll.conversation_id]
    );
    for (const member of members) {
      emitEvent('chat:poll-updated', { messageId: poll.message_id, conversationId: poll.conversation_id, poll: updatedPoll }, `user:${member.user_id}`);
    }

    res.json(updatedPoll);
  } catch (err) {
    console.error('votePoll error:', err);
    res.status(500).json({ message: 'Failed to vote' });
  }
};


// ─── Add members to a group conversation ──────────────────────────────────────
exports.addMembers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;
    const { member_ids = [] } = req.body;

    if (!member_ids.length) {
      return res.status(400).json({ message: 'Member IDs are required' });
    }

    // Verify conversation is a group
    const [[conv]] = await db.query('SELECT id, type, name FROM conversations WHERE id = ?', [conversationId]);
    if (!conv) return res.status(404).json({ message: 'Conversation not found' });
    if (conv.type !== 'group') return res.status(400).json({ message: 'Can only add members to group chats' });

    // Verify requester is admin
    const [[membership]] = await db.query(
      'SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (!membership) return res.status(403).json({ message: 'Not a member' });
    if (membership.role !== 'admin') return res.status(403).json({ message: 'Only admins can add members' });

    const added = [];
    for (const memberId of member_ids) {
      // Check if already a member
      const [existing] = await db.query(
        'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
        [conversationId, memberId]
      );
      if (existing.length > 0) continue;

      await db.query(
        'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
        [conversationId, Number(memberId), 'member']
      );
      added.push(Number(memberId));

      // Send system message
      const [[addedUser]] = await db.query('SELECT first_name, last_name FROM users WHERE id = ?', [memberId]);
      const [[adder]] = await db.query('SELECT first_name, last_name FROM users WHERE id = ?', [userId]);
      if (addedUser && adder) {
        await db.query(
          "INSERT INTO messages (conversation_id, sender_id, content, message_type) VALUES (?, ?, ?, 'system')",
          [conversationId, userId, `${adder.first_name} ${adder.last_name} added ${addedUser.first_name} ${addedUser.last_name}`]
        );
      }

      // Notify the added user
      emitEvent('chat:conversation-created', { conversationId }, `user:${memberId}`);
    }

    // Notify existing members
    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [conversationId]
    );
    for (const member of members) {
      emitEvent('chat:members-updated', { conversationId: parseInt(conversationId), action: 'added', member_ids: added }, `user:${member.user_id}`);
    }

    res.json({ success: true, added });
  } catch (err) {
    console.error('addMembers error:', err);
    res.status(500).json({ message: 'Failed to add members' });
  }
};

// ─── Remove a member from a group conversation ───────────────────────────────
exports.removeMember = async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId, memberId } = req.params;

    // Verify conversation is a group
    const [[conv]] = await db.query('SELECT id, type, created_by FROM conversations WHERE id = ?', [conversationId]);
    if (!conv) return res.status(404).json({ message: 'Conversation not found' });
    if (conv.type !== 'group') return res.status(400).json({ message: 'Can only remove members from group chats' });

    // Verify requester is admin (or removing self = leaving)
    const [[membership]] = await db.query(
      'SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (!membership) return res.status(403).json({ message: 'Not a member' });

    const isSelf = Number(memberId) === userId;
    if (!isSelf && membership.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can remove members' });
    }

    // Cannot remove the creator
    if (Number(memberId) === conv.created_by && !isSelf) {
      return res.status(400).json({ message: 'Cannot remove the group creator' });
    }

    await db.query(
      'DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [conversationId, Number(memberId)]
    );

    // Send system message
    const [[removedUser]] = await db.query('SELECT first_name, last_name FROM users WHERE id = ?', [memberId]);
    const [[remover]] = await db.query('SELECT first_name, last_name FROM users WHERE id = ?', [userId]);
    if (removedUser && remover) {
      const content = isSelf
        ? `${removedUser.first_name} ${removedUser.last_name} left the group`
        : `${remover.first_name} ${remover.last_name} removed ${removedUser.first_name} ${removedUser.last_name}`;
      await db.query(
        "INSERT INTO messages (conversation_id, sender_id, content, message_type) VALUES (?, ?, ?, 'system')",
        [conversationId, userId, content]
      );
    }

    // Notify members
    const [members] = await db.query(
      'SELECT user_id FROM conversation_members WHERE conversation_id = ?',
      [conversationId]
    );
    for (const member of members) {
      emitEvent('chat:members-updated', { conversationId: parseInt(conversationId), action: 'removed', member_ids: [Number(memberId)] }, `user:${member.user_id}`);
    }
    // Also notify the removed user
    emitEvent('chat:members-updated', { conversationId: parseInt(conversationId), action: 'removed', member_ids: [Number(memberId)] }, `user:${memberId}`);

    res.json({ success: true });
  } catch (err) {
    console.error('removeMember error:', err);
    res.status(500).json({ message: 'Failed to remove member' });
  }
};
