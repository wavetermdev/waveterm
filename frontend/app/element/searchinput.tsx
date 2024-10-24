// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "./button";
import { Input, InputGroup, InputRightElement } from "./input";

const SearchInput = () => {
    return (
        <InputGroup className="search-input-group">
            <Input placeholder="Search..." />
            <InputRightElement>
                <Button className="search-button ghost grey">
                    <i className="fa-sharp fa-solid fa-magnifying-glass"></i>
                </Button>
            </InputRightElement>
        </InputGroup>
    );
};

export { SearchInput };
