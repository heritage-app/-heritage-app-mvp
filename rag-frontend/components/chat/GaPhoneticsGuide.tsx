"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Ga pronunciation data, verbatim from the Bureau of Ghana Languages
 * "Language Guide (Ga Version)" — the same source as the indexed archive.
 * Each entry: the sound, a Ga example word, and the closest English sound.
 */
export interface GaSound {
  symbol: string;
  example: string;
  english: string;
}

export const GA_SHORT_VOWELS: GaSound[] = [
  { symbol: "a", example: "ba (to come)", english: "'a' in father" },
  { symbol: "e", example: "le (to know)", english: "'a' in cake" },
  { symbol: "ɛ", example: "fɛ (to burst)", english: "'e' in bet" },
  { symbol: "i", example: "bi (child)", english: "'ea' in read" },
  { symbol: "o", example: "fo (to weep)", english: "'o' in pole" },
  { symbol: "ɔ", example: "tɔ (bottle)", english: "'o' in pot" },
  { symbol: "u", example: "tu (to jump)", english: "'oo' in good" },
];

export const GA_LONG_VOWELS: GaSound[] = [
  { symbol: "aa", example: "faa (river)", english: "'a' in far" },
  { symbol: "ee", example: "fee (did)", english: "'ay' in lay" },
  { symbol: "ɛɛ", example: "lɛɛ (upbringing)", english: "'ai' in fair" },
  { symbol: "ii", example: "bii (children)", english: "'ee' in fee" },
  { symbol: "oo", example: "loo (fish)", english: "'o' in so" },
  { symbol: "ɔɔ", example: "wɔɔ (sleeping)", english: "'o' in or" },
  { symbol: "uu", example: "buu (tent)", english: "'wo' in two" },
];

export const GA_DIGRAPH_SOUNDS: GaSound[] = [
  { symbol: "gb", example: "gba (to tear)", english: "no English equivalent" },
  { symbol: "gw", example: "gwantɛŋ (sheep)", english: "no English equivalent" },
  { symbol: "hw", example: "hwanya (to shake)", english: "'wh' in what" },
  { symbol: "jw", example: "jwɛi (rubbish)", english: "no English equivalent" },
  { symbol: "kp", example: "kpe (to chew)", english: "no English equivalent" },
  { symbol: "kw", example: "kwɛ (to look)", english: "'qu' in quad" },
  { symbol: "ny", example: "nyɛ (you, plural)", english: "'ny' in canyon" },
  { symbol: "ŋ", example: "ŋoo (salt)", english: "'ng' in sing" },
  { symbol: "ŋm", example: "ŋme (palm fruit)", english: "no English equivalent" },
  { symbol: "ŋw", example: "ŋwɛi (the sky)", english: "no English equivalent" },
  { symbol: "sh", example: "shi (to knock)", english: "'sh' in she" },
  { symbol: "ts", example: "tse (to pluck)", english: "'ch' in church" },
  { symbol: "shw", example: "shwa (to blame)", english: "no English equivalent" },
  { symbol: "tsw", example: "tswa (to strike)", english: "no English equivalent" },
  { symbol: "ã", example: "fã (half)", english: "nasalized 'a'" },
];

/** Quick tooltip text for an input-row chip, or undefined if unknown. */
export function gaSoundTooltip(symbol: string): string | undefined {
  const all = [...GA_SHORT_VOWELS, ...GA_LONG_VOWELS, ...GA_DIGRAPH_SOUNDS];
  const s = all.find((x) => x.symbol === symbol.toLowerCase());
  return s ? `${s.symbol} — like ${s.english}, as in ${s.example}` : undefined;
}

function SoundSection({ title, sounds }: { title: string; sounds: GaSound[] }) {
  return (
    <div>
      <h4 className="mb-2 text-[0.6rem] font-mono font-bold uppercase tracking-widest text-primary/60">
        {title}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {sounds.map((s) => (
          <div key={s.symbol} className="flex items-baseline gap-2 text-sm">
            <span className="w-9 shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-center font-semibold text-primary">
              {s.symbol}
            </span>
            <span className="text-foreground/80">{s.english}</span>
            <span className="ml-auto text-right text-xs italic text-foreground/40">{s.example}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface GaPhoneticsGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Dialog showing how every Ga sound is pronounced, per the Language Guide. */
export function GaPhoneticsGuide({ open, onOpenChange }: GaPhoneticsGuideProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border-primary/20 bg-background/95 backdrop-blur-2xl">
        <DialogHeader>
          <DialogTitle className="font-bold tracking-tight">How Ga sounds are pronounced</DialogTitle>
          <DialogDescription className="text-xs text-foreground/50">
            From the Bureau of Ghana Languages guide. Ga is tonal — meaning can change with
            tone. English equivalents are close approximations.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <SoundSection title="Short vowels" sounds={GA_SHORT_VOWELS} />
          <SoundSection title="Long vowels" sounds={GA_LONG_VOWELS} />
          <SoundSection title="Digraphs & trigraphs" sounds={GA_DIGRAPH_SOUNDS} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
