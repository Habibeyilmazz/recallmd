---
deck: Learn recallmd in 2 minutes
tags: [sample]
---

# Learn recallmd in 2 minutes

These are ordinary Markdown notes. Every line or block below that uses one of
recallmd's card syntaxes became a flashcard. Open this file in the repository
(`src/sample/learn-recallmd.md`) to see exactly what was typed.

## One-line cards

Which two characters turn a line of notes into a flashcard? :: Two colons with a space on each side, as in `Question :: Answer`.
Which key shows the answer during a review? :: Space (Enter works too).
- Which keys rate a card? :: `1` Again, `2` Hard, `3` Good, `4` Easy. Space also means Good once the answer is showing.
- Which key takes back your last rating? :: `Z`

## Cloze deletions

Wrap the part to hide in ==two equals signs== and recallmd makes a fill-in-the-blank card.
recallmd schedules reviews with the ==FSRS== algorithm, and stores everything in ==your browser==, not on a server.

## Multi-line cards

Q: How do you write a card whose answer needs several lines, for example code?
A: Start the question with `Q:` and the answer with `A:`. The answer runs until the next blank line, and code fences may contain blank lines:
```python
def is_due(card, today):

    return card.due <= today
```

Q: Is math rendered?
A: Yes, with KaTeX. Inline like $e^{i\pi} + 1 = 0$, or as a block:
$$\int_0^1 x^2 \, dx = \frac{1}{3}$$

## Getting your own notes in

How do you add your own notes? :: Drop `.md` files or a whole folder (an Obsidian vault works) onto the Decks page, or paste text.
What decides which deck a card lands in? :: The note's folder and file name, or a `deck:` line in its front matter.
You fixed a typo in a note and imported it again. What happens to that card's progress? :: It is kept. Cards are matched by their question, so edited answers and lightly reworded questions keep their schedule.
What do the four ratings change? :: When you see the card next. Again brings it back within minutes; Hard, Good and Easy push it progressively further out.
How do you move your progress to another device? :: Settings → Export progress, then import that JSON file there.
