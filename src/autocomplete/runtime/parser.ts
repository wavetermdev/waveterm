// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CommandToken = {
  token: string;
  complete: boolean;
  isOption: boolean;
  isPersistent?: boolean;
  isPath?: boolean;
  isPathComplete?: boolean;
};

const cmdDelim = /(\|\|)|(&&)|(;)|(\|)/;
const spaceRegex = /\s/;

export const parseCommand = (command: string): CommandToken[] => {
  const lastCommand = command.split(cmdDelim).at(-1)?.trimStart();
  return lastCommand ? lex(lastCommand) : [];
};

const lex = (command: string): CommandToken[] => {
  const tokens: CommandToken[] = [];
  let [readingQuotedString, readingFlag, readingCmd] = [false, false, false];
  let readingIdx = 0;
  let readingQuoteChar = "";

  [...command].forEach((char, idx) => {
    const reading = readingQuotedString || readingFlag || readingCmd;
    if (!reading && (char === `'` || char === `"`)) {
      [readingQuotedString, readingIdx, readingQuoteChar] = [true, idx, char];
      return;
    } else if (!reading && char === `-`) {
      [readingFlag, readingIdx] = [true, idx];
      return;
    } else if (!reading && !spaceRegex.test(char)) {
      [readingCmd, readingIdx] = [true, idx];
      return;
    }

    if (readingQuotedString && char === readingQuoteChar && command.at(idx - 1) !== "\\") {
      readingQuotedString = false;
      const complete = idx + 1 < command.length && spaceRegex.test(command[idx + 1]);
      tokens.push({
        token: command.slice(readingIdx, idx + 1),
        complete,
        isOption: false,
      });
    } else if ((readingFlag && spaceRegex.test(char)) || char === "=") {
      readingFlag = false;
      tokens.push({
        token: command.slice(readingIdx, idx),
        complete: true,
        isOption: true,
      });
    } else if (readingCmd && spaceRegex.test(char)) {
      readingCmd = false;
      tokens.push({
        token: command.slice(readingIdx, idx),
        complete: true,
        isOption: false,
      });
    }
  });

  const reading = readingQuotedString || readingFlag || readingCmd;
  if (reading) {
    tokens.push({
      token: command.slice(readingIdx),
      complete: false,
      isOption: readingFlag,
    });
  }

  return tokens;
};
