// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import {
    Dimensions,
    DropDirection,
    FlexDirection,
    determineDropDirection,
    reverseFlexDirection,
} from "../lib/utils.js";

test("determineDropDirection", () => {
    const dimensions: Dimensions = {
        top: 0,
        left: 0,
        height: 3,
        width: 3,
    };

    assert.equal(
        determineDropDirection(dimensions, {
            x: 1.5,
            y: 0.5,
        }),
        DropDirection.Top
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 1.5,
            y: 2.5,
        }),
        DropDirection.Bottom
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 2.5,
            y: 1.5,
        }),
        DropDirection.Right
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 0.5,
            y: 1.5,
        }),
        DropDirection.Left
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 1.5,
            y: 1.5,
        }),
        undefined
    );
});

test("reverseFlexDirection", () => {
    assert.equal(reverseFlexDirection(FlexDirection.Row), FlexDirection.Column);
    assert.equal(reverseFlexDirection(FlexDirection.Column), FlexDirection.Row);
});
