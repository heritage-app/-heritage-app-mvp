-- 2026-10-13: extra English wordings for checked everyday phrases (English only;
-- the Ga is unchanged), approved by the project owner. Written the way questions
-- arrive: the app spells out contractions ("i'm good" -> "i am good").
-- Applied to the live database; kept here so the repo matches it.

UPDATE vocabulary
   SET translations = '["see you soon","see you","see you later","see you in a bit"]'
 WHERE id = 'vocab:owner:0162';
UPDATE vocabulary SET translations = '["thank you","thanks"]' WHERE id = 'vocab:0034';
UPDATE vocabulary SET translations = '["yes","yeah","yep"]' WHERE id = 'vocab:0035';
UPDATE vocabulary SET translations = '["no","nope"]' WHERE id = 'vocab:0036';
UPDATE vocabulary SET translations = '["good morning","morning"]' WHERE id = 'vocab:0051';
UPDATE vocabulary SET translations = '["goodbye","bye","bye bye","farewell"]' WHERE id = 'vocab:0054';
UPDATE vocabulary SET translations = '["come here","come over here"]' WHERE id = 'vocab:0093';
UPDATE vocabulary SET translations = '["how are you?","how are you doing","how is it going","how are things"]' WHERE id = 'vocab:0095';
UPDATE vocabulary SET translations = '["I am fine","i am good","i am well","i am okay"]' WHERE id = 'vocab:0096';
UPDATE vocabulary SET translations = '["right now","immediately","at once"]' WHERE id = 'vocab:0391';
UPDATE vocabulary SET translations = '["i am fine","i''m fine","i am good","i am well","i am okay"]' WHERE id = 'vocab:owner:0019';
UPDATE vocabulary SET translations = '["nice to meet you","pleased to meet you","good to meet you"]' WHERE id = 'vocab:owner:0161';
UPDATE vocabulary SET translations = '["how was your day","how did your day go"]' WHERE id = 'vocab:owner:0163';
UPDATE vocabulary SET translations = '["what is going on","whats going on","what is happening","what is up"]' WHERE id = 'vocab:owner:0165';
UPDATE vocabulary SET translations = '["what is your name","what are you called"]' WHERE id = 'vocab:owner:0167';
UPDATE vocabulary SET translations = '["you are welcome","youre welcome","my pleasure","do not mention it"]' WHERE id = 'vocab:owner:0176';
UPDATE vocabulary SET translations = '["god bless you","bless you"]' WHERE id = 'vocab:owner:0178';
UPDATE vocabulary SET translations = '["i am sorry","sorry","my apologies","i apologise"]' WHERE id = 'vocab:owner:0180';
UPDATE vocabulary SET translations = '["it is okay","its okay","its fine","it is alright","all right"]' WHERE id = 'vocab:owner:0181';
UPDATE vocabulary SET translations = '["excuse me","pardon me"]' WHERE id = 'vocab:owner:0183';
UPDATE vocabulary SET translations = '["i dont understand","i do not understand","i do not get it"]' WHERE id = 'vocab:owner:0185';
UPDATE vocabulary SET translations = '["i dont know","i do not know","i have no idea","no idea"]' WHERE id = 'vocab:owner:0186';
UPDATE vocabulary SET translations = '["i am done","i am finished","i have finished","that is all"]' WHERE id = 'vocab:owner:0188';
UPDATE vocabulary SET translations = '["no problem","nothing at all","no worries"]' WHERE id = 'vocab:owner:0189';
UPDATE vocabulary SET translations = '["i havent seen you for ages","long time no see","it has been a long time","i have not seen you in a while"]' WHERE id = 'vocab:owner:0194';
UPDATE vocabulary SET translations = '["sit down","sit","have a seat","take a seat"]' WHERE id = 'vocab:owner:0319';
UPDATE vocabulary SET translations = '["stand up","stand","get up"]' WHERE id = 'vocab:owner:0320';
UPDATE vocabulary SET translations = '["merry christmas","christmas","happy christmas"]' WHERE id = 'vocab:owner:0373';
