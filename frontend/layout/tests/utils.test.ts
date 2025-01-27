// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { DropDirection, FlexDirection } from "../lib/types";
import { determineDropDirection, reverseFlexDirection } from "../lib/utils";

test("determineDropDirection", () => {
    const dimensions: Dimensions = {
        top: 0,
        left: 0,
        height: 5,
        width: 5,
    };

    assert.equal(
        determineDropDirection(dimensions, {
            x: 2.5,
            y: 1.5,
        }),
        DropDirection.Top
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 2.5,
            y: 3.5,
        }),
        DropDirection.Bottom
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 3.5,
            y: 2.5,
        }),
        DropDirection.Right
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 1.5,
            y: 2.5,
        }),
        DropDirection.Left
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 2.5,
            y: 0.5,
        }),
        DropDirection.OuterTop
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 4.5,
            y: 2.5,
        }),
        DropDirection.OuterRight
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 2.5,
            y: 4.5,
        }),
        DropDirection.OuterBottom
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 0.5,
            y: 2.5,
        }),
        DropDirection.OuterLeft
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 2.5,
            y: 2.5,
        }),
        DropDirection.Center
    );

    assert.equal(
        determineDropDirection(dimensions, {
            x: 2.51,
            y: 2.51,
        }),
        DropDirection.Center
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
