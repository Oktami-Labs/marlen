export const CHAT_ATTACHMENT_SCHEMA_STEP = `
  CREATE TABLE chat_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    extracted_text TEXT,
    created_at TEXT NOT NULL,
    CHECK (kind IN ('image', 'document')),
    CHECK (position >= 0),
    CHECK (
      (kind = 'image' AND extracted_text IS NULL) OR
      (kind = 'document' AND extracted_text IS NOT NULL)
    )
  );
  CREATE UNIQUE INDEX idx_chat_attachments_message_position
    ON chat_attachments(message_id, position);
  CREATE INDEX idx_chat_attachments_conversation ON chat_attachments(conversation_id);
`;

export const CHAT_ATTACHMENT_POSITION_REPAIR_SCHEMA_STEP = `
  ALTER TABLE chat_attachments RENAME TO chat_attachments_before_position;
  CREATE TABLE chat_attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    position INTEGER NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    extracted_text TEXT,
    created_at TEXT NOT NULL,
    CHECK (kind IN ('image', 'document')),
    CHECK (position >= 0),
    CHECK (
      (kind = 'image' AND extracted_text IS NULL) OR
      (kind = 'document' AND extracted_text IS NOT NULL)
    )
  );
  INSERT INTO chat_attachments (
    id, message_id, conversation_id, name, mime_type, kind, position,
    size, data, extracted_text, created_at
  )
  SELECT
    id, message_id, conversation_id, name, mime_type, kind,
    row_number() OVER (PARTITION BY message_id ORDER BY rowid) - 1,
    size, data, extracted_text, created_at
  FROM chat_attachments_before_position;
  DROP TABLE chat_attachments_before_position;
  CREATE UNIQUE INDEX idx_chat_attachments_message_position
    ON chat_attachments(message_id, position);
  CREATE INDEX idx_chat_attachments_conversation ON chat_attachments(conversation_id);
`;
