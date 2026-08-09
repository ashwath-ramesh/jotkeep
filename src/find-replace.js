const WORD_CHARACTER = /[\p{L}\p{M}\p{N}\p{Pc}]/u;

function escapeRegularExpression(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function codePointBefore(text, offset) {
  if (offset <= 0) {
    return "";
  }

  const lastCodeUnit = text.charCodeAt(offset - 1);
  const startsSurrogatePair =
    lastCodeUnit >= 0xdc00 &&
    lastCodeUnit <= 0xdfff &&
    offset > 1 &&
    text.charCodeAt(offset - 2) >= 0xd800 &&
    text.charCodeAt(offset - 2) <= 0xdbff;

  return text.slice(offset - (startsSurrogatePair ? 2 : 1), offset);
}

function codePointAfter(text, offset) {
  if (offset >= text.length) {
    return "";
  }

  const codePoint = text.codePointAt(offset);
  return String.fromCodePoint(codePoint);
}

function isWordCharacter(character) {
  return character !== "" && WORD_CHARACTER.test(character);
}

function hasWholeWordBoundaries(text, query, start, end) {
  const firstQueryCharacter = codePointAfter(query, 0);
  const lastQueryCharacter = codePointBefore(query, query.length);

  if (
    isWordCharacter(firstQueryCharacter) &&
    isWordCharacter(codePointBefore(text, start))
  ) {
    return false;
  }

  return !(
    isWordCharacter(lastQueryCharacter) &&
    isWordCharacter(codePointAfter(text, end))
  );
}

export function findMatches(
  text,
  query,
  { matchCase = false, wholeWord = false } = {},
) {
  if (query === "") {
    return [];
  }

  const flags = matchCase ? "gu" : "giu";
  const matcher = new RegExp(escapeRegularExpression(query), flags);
  const matches = [];

  for (const match of text.matchAll(matcher)) {
    const start = match.index;
    const end = start + match[0].length;

    if (!wholeWord || hasWholeWordBoundaries(text, query, start, end)) {
      matches.push({ start, end });
    }
  }

  return matches;
}

export function currentMatchIndex(matches, selection) {
  return matches.findIndex(
    (match) =>
      match.start === selection.start && match.end === selection.end,
  );
}

export function findAdjacentMatch(matches, selection, direction = "next") {
  if (matches.length === 0) {
    return null;
  }

  if (direction === "previous") {
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (matches[index].end <= selection.start) {
        return { match: matches[index], index, wrapped: false };
      }
    }

    return {
      match: matches[matches.length - 1],
      index: matches.length - 1,
      wrapped: true,
    };
  }

  const index = matches.findIndex((match) => match.start >= selection.end);

  if (index !== -1) {
    return { match: matches[index], index, wrapped: false };
  }

  return { match: matches[0], index: 0, wrapped: true };
}

export function replaceAllLiteral(
  text,
  query,
  replacement,
  options = {},
) {
  const matches = findMatches(text, query, options);

  if (matches.length === 0) {
    return { text, count: 0, caret: null };
  }

  const parts = [];
  let sourceOffset = 0;
  let outputLength = 0;
  let caret = 0;

  for (const match of matches) {
    const unchanged = text.slice(sourceOffset, match.start);
    parts.push(unchanged, replacement);
    outputLength += unchanged.length + replacement.length;
    caret = outputLength;
    sourceOffset = match.end;
  }

  parts.push(text.slice(sourceOffset));

  return {
    text: parts.join(""),
    count: matches.length,
    caret,
  };
}
