-- Migration: Add media_url to conversation_messages table
ALTER TABLE public.conversation_messages ADD COLUMN IF NOT EXISTS media_url text;
