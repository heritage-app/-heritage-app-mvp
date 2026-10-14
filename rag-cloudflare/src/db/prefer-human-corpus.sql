-- Corpus searches (service.ts corpus probe, deduce.ts, pages.ts examples) take
-- the first rows that match, scanned in id order, up to a LIMIT. The bulk sets
-- (GhanaNLP 400k: mostly Bible/JW text; farmer Q&A: machine-translated, 272k
-- rows) sit at low ids and filled those limits, crowding out the human
-- translations. Negative ids put the human sets first at no query cost.
-- Applied 2026-10-14. New rows from these sources should get the same.
UPDATE corpus_pairs SET id = -id WHERE id > 0 AND src = 'Ghana-NLP GA_ENGLISH_PARALLEL_TEXT — CC-BY-4.0';
UPDATE corpus_pairs SET id = -id WHERE id > 0 AND src = 'Google SMOL (CC-BY 4.0), huggingface.co/datasets/google/smol';
