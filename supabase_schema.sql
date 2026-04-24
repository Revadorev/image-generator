-- Tabel pentru conversații cu memorie
CREATE TABLE IF NOT EXISTS image_generator_conversations (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pentru căutare rapidă după session_id
CREATE INDEX IF NOT EXISTS idx_session_id ON image_generator_conversations(session_id);

-- Comentarii
COMMENT ON TABLE image_generator_conversations IS 'Stochează conversațiile AI Agent pentru memorie persistentă';
COMMENT ON COLUMN image_generator_conversations.session_id IS 'ID unic de sesiune (poate fi user ID sau browser fingerprint)';
COMMENT ON COLUMN image_generator_conversations.messages IS 'Array de mesaje în format [{role, content}]';
