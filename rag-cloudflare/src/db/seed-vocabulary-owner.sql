-- Vocabulary supplied directly by the project owner.
--
-- These entries clear the integrity gate (source + verified_at present) on the
-- owner's authority rather than a printed source, and the `source` says so
-- plainly. Idempotent: rerunning replaces this set and nothing else.
--
-- Spelling: "Hani wɔyeni" is taken from the owner's in-app entry
-- ("lets eat = hani wɔyeni"). A chat message the same day wrote "woyeni"
-- without the ɔ; the deliberate in-app form is used. Both fold to the same
-- lookup key, so either spelling typed by a user will find it.
DELETE FROM vocabulary WHERE verified_by = 'project-owner';
INSERT OR REPLACE INTO vocabulary (id,headword,headword_normalized,part_of_speech,meanings,translations,examples,variants,phonetic,category,source,verified_by,verified_at) VALUES ('vocab:owner:0001','Hani wɔyeni','hani woyeni','phrase','["Let''s eat"]','["let''s eat"]','[]','[]',NULL,'food','Heritage project owner — supplied directly, 2026-09-28','project-owner','2026-09-28T12:30:00Z');
INSERT OR REPLACE INTO vocabulary (id,headword,headword_normalized,part_of_speech,meanings,translations,examples,variants,phonetic,category,source,verified_by,verified_at) VALUES ('vocab:owner:0003','niyeli','niyeli','verb','["To eat"]','["to eat"]','[]','[]',NULL,'food','Heritage project owner — supplied directly, 2026-09-28','project-owner','2026-09-28T12:30:00Z');
