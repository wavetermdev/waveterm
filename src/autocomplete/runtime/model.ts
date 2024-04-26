export enum TokenType {
    UNKNOWN,
    PATH,
    FLAG,
    OPTION,
    ARGUMENT,
    WHITESPACE,
}

export interface Token {
    type: TokenType;
    value: string | undefined;
}

export interface PathToken extends Token {
    type: TokenType.PATH;
    value: string;
    prefix?: string;
}

export const whitespace: Token = { type: TokenType.WHITESPACE, value: undefined };
