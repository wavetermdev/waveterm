// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { type Placement } from "@floating-ui/react";
import clsx from "clsx";
import { memo, useState } from "react";
import { Button } from "./button";
import { Input, InputGroup, InputLeftElement } from "./input";
import { Popover, PopoverButton, PopoverContent } from "./popover";

import "./emojipalette.scss";

type EmojiItem = { emoji: string; name: string };

const emojiList: EmojiItem[] = [
    // Smileys & Emotion
    { emoji: "😀", name: "grinning face" },
    { emoji: "😁", name: "beaming face with smiling eyes" },
    { emoji: "😂", name: "face with tears of joy" },
    { emoji: "🤣", name: "rolling on the floor laughing" },
    { emoji: "😃", name: "grinning face with big eyes" },
    { emoji: "😄", name: "grinning face with smiling eyes" },
    { emoji: "😅", name: "grinning face with sweat" },
    { emoji: "😆", name: "grinning squinting face" },
    { emoji: "😉", name: "winking face" },
    { emoji: "😊", name: "smiling face with smiling eyes" },
    { emoji: "😋", name: "face savoring food" },
    { emoji: "😎", name: "smiling face with sunglasses" },
    { emoji: "😍", name: "smiling face with heart-eyes" },
    { emoji: "😘", name: "face blowing a kiss" },
    { emoji: "😗", name: "kissing face" },
    { emoji: "😙", name: "kissing face with smiling eyes" },
    { emoji: "😚", name: "kissing face with closed eyes" },
    { emoji: "🙂", name: "slightly smiling face" },
    { emoji: "🤗", name: "hugging face" },
    { emoji: "🤔", name: "thinking face" },
    { emoji: "😐", name: "neutral face" },
    { emoji: "😑", name: "expressionless face" },
    { emoji: "😶", name: "face without mouth" },
    { emoji: "🙄", name: "face with rolling eyes" },
    { emoji: "😏", name: "smirking face" },
    { emoji: "😣", name: "persevering face" },
    { emoji: "😥", name: "sad but relieved face" },
    { emoji: "😮", name: "face with open mouth" },
    { emoji: "🤐", name: "zipper-mouth face" },
    { emoji: "😯", name: "hushed face" },
    { emoji: "😪", name: "sleepy face" },
    { emoji: "😫", name: "tired face" },
    { emoji: "🥱", name: "yawning face" },
    { emoji: "😴", name: "sleeping face" },
    { emoji: "😌", name: "relieved face" },
    { emoji: "😛", name: "face with tongue" },
    { emoji: "😜", name: "winking face with tongue" },
    { emoji: "😝", name: "squinting face with tongue" },
    { emoji: "🤤", name: "drooling face" },
    { emoji: "😒", name: "unamused face" },
    { emoji: "😓", name: "downcast face with sweat" },
    { emoji: "😔", name: "pensive face" },
    { emoji: "😕", name: "confused face" },
    { emoji: "🙃", name: "upside-down face" },
    { emoji: "🫠", name: "melting face" },
    { emoji: "😲", name: "astonished face" },
    { emoji: "☹️", name: "frowning face" },
    { emoji: "🙁", name: "slightly frowning face" },
    { emoji: "😖", name: "confounded face" },
    { emoji: "😞", name: "disappointed face" },
    { emoji: "😟", name: "worried face" },
    { emoji: "😤", name: "face with steam from nose" },
    { emoji: "😢", name: "crying face" },
    { emoji: "😭", name: "loudly crying face" },
    { emoji: "😦", name: "frowning face with open mouth" },
    { emoji: "😧", name: "anguished face" },
    { emoji: "😨", name: "fearful face" },
    { emoji: "😩", name: "weary face" },
    { emoji: "🤯", name: "exploding head" },
    { emoji: "😬", name: "grimacing face" },
    { emoji: "😰", name: "anxious face with sweat" },
    { emoji: "😱", name: "face screaming in fear" },
    { emoji: "🥵", name: "hot face" },
    { emoji: "🥶", name: "cold face" },
    { emoji: "😳", name: "flushed face" },
    { emoji: "🤪", name: "zany face" },
    { emoji: "😵", name: "dizzy face" },
    { emoji: "🥴", name: "woozy face" },
    { emoji: "😠", name: "angry face" },
    { emoji: "😡", name: "pouting face" },
    { emoji: "🤬", name: "face with symbols on mouth" },
    { emoji: "🤮", name: "face vomiting" },
    { emoji: "🤢", name: "nauseated face" },
    { emoji: "😷", name: "face with medical mask" },

    // Gestures & Hand Signs
    { emoji: "👋", name: "waving hand" },
    { emoji: "🤚", name: "raised back of hand" },
    { emoji: "🖐️", name: "hand with fingers splayed" },
    { emoji: "✋", name: "raised hand" },
    { emoji: "👌", name: "OK hand" },
    { emoji: "✌️", name: "victory hand" },
    { emoji: "🤞", name: "crossed fingers" },
    { emoji: "🤟", name: "love-you gesture" },
    { emoji: "🤘", name: "sign of the horns" },
    { emoji: "🤙", name: "call me hand" },
    { emoji: "👈", name: "backhand index pointing left" },
    { emoji: "👉", name: "backhand index pointing right" },
    { emoji: "👆", name: "backhand index pointing up" },
    { emoji: "👇", name: "backhand index pointing down" },
    { emoji: "👍", name: "thumbs up" },
    { emoji: "👎", name: "thumbs down" },
    { emoji: "👏", name: "clapping hands" },
    { emoji: "🙌", name: "raising hands" },
    { emoji: "👐", name: "open hands" },
    { emoji: "🙏", name: "folded hands" },

    // Animals & Nature
    { emoji: "🐶", name: "dog face" },
    { emoji: "🐱", name: "cat face" },
    { emoji: "🐭", name: "mouse face" },
    { emoji: "🐹", name: "hamster face" },
    { emoji: "🐰", name: "rabbit face" },
    { emoji: "🦊", name: "fox face" },
    { emoji: "🐻", name: "bear face" },
    { emoji: "🐼", name: "panda face" },
    { emoji: "🐨", name: "koala" },
    { emoji: "🐯", name: "tiger face" },
    { emoji: "🦁", name: "lion" },
    { emoji: "🐮", name: "cow face" },
    { emoji: "🐷", name: "pig face" },
    { emoji: "🐸", name: "frog face" },
    { emoji: "🐵", name: "monkey face" },
    { emoji: "🦄", name: "unicorn face" },
    { emoji: "🐢", name: "turtle" },
    { emoji: "🐍", name: "snake" },
    { emoji: "🦋", name: "butterfly" },
    { emoji: "🐝", name: "honeybee" },
    { emoji: "🐞", name: "lady beetle" },
    { emoji: "🦀", name: "crab" },
    { emoji: "🐠", name: "tropical fish" },
    { emoji: "🐟", name: "fish" },
    { emoji: "🐬", name: "dolphin" },
    { emoji: "🐳", name: "spouting whale" },
    { emoji: "🐋", name: "whale" },
    { emoji: "🦈", name: "shark" },

    // Food & Drink
    { emoji: "🍏", name: "green apple" },
    { emoji: "🍎", name: "red apple" },
    { emoji: "🍐", name: "pear" },
    { emoji: "🍊", name: "tangerine" },
    { emoji: "🍋", name: "lemon" },
    { emoji: "🍌", name: "banana" },
    { emoji: "🍉", name: "watermelon" },
    { emoji: "🍇", name: "grapes" },
    { emoji: "🍓", name: "strawberry" },
    { emoji: "🫐", name: "blueberries" },
    { emoji: "🍈", name: "melon" },
    { emoji: "🍒", name: "cherries" },
    { emoji: "🍑", name: "peach" },
    { emoji: "🥭", name: "mango" },
    { emoji: "🍍", name: "pineapple" },
    { emoji: "🥥", name: "coconut" },
    { emoji: "🥑", name: "avocado" },
    { emoji: "🥦", name: "broccoli" },
    { emoji: "🥕", name: "carrot" },
    { emoji: "🌽", name: "corn" },
    { emoji: "🌶️", name: "hot pepper" },
    { emoji: "🍔", name: "hamburger" },
    { emoji: "🍟", name: "french fries" },
    { emoji: "🍕", name: "pizza" },
    { emoji: "🌭", name: "hot dog" },
    { emoji: "🥪", name: "sandwich" },
    { emoji: "🍿", name: "popcorn" },
    { emoji: "🥓", name: "bacon" },
    { emoji: "🥚", name: "egg" },
    { emoji: "🍰", name: "cake" },
    { emoji: "🎂", name: "birthday cake" },
    { emoji: "🍦", name: "ice cream" },
    { emoji: "🍩", name: "doughnut" },
    { emoji: "🍪", name: "cookie" },
    { emoji: "🍫", name: "chocolate bar" },
    { emoji: "🍬", name: "candy" },
    { emoji: "🍭", name: "lollipop" },

    // Activities
    { emoji: "⚽", name: "soccer ball" },
    { emoji: "🏀", name: "basketball" },
    { emoji: "🏈", name: "american football" },
    { emoji: "⚾", name: "baseball" },
    { emoji: "🥎", name: "softball" },
    { emoji: "🎾", name: "tennis" },
    { emoji: "🏐", name: "volleyball" },
    { emoji: "🎳", name: "bowling" },
    { emoji: "⛳", name: "flag in hole" },
    { emoji: "🚴", name: "person biking" },
    { emoji: "🎮", name: "video game" },
    { emoji: "🎲", name: "game die" },
    { emoji: "🎸", name: "guitar" },
    { emoji: "🎺", name: "trumpet" },

    // Miscellaneous
    { emoji: "🚀", name: "rocket" },
    { emoji: "💖", name: "sparkling heart" },
    { emoji: "🎉", name: "party popper" },
    { emoji: "🔥", name: "fire" },
    { emoji: "🎁", name: "gift" },
    { emoji: "❤️", name: "red heart" },
    { emoji: "🧡", name: "orange heart" },
    { emoji: "💛", name: "yellow heart" },
    { emoji: "💚", name: "green heart" },
    { emoji: "💙", name: "blue heart" },
    { emoji: "💜", name: "purple heart" },
    { emoji: "🤍", name: "white heart" },
    { emoji: "🤎", name: "brown heart" },
    { emoji: "💔", name: "broken heart" },
];

interface EmojiPaletteProps {
    className?: string;
    placement?: Placement;
    onSelect?: (_: EmojiItem) => void;
}

const EmojiPalette = memo(({ className, placement, onSelect }: EmojiPaletteProps) => {
    const [searchTerm, setSearchTerm] = useState("");

    const handleSearchChange = (val: string) => {
        setSearchTerm(val.toLowerCase());
    };

    const handleSelect = (item: { name: string; emoji: string }) => {
        onSelect?.(item);
    };

    const filteredEmojis = emojiList.filter((item) => item.name.includes(searchTerm));

    return (
        <div className={clsx("emoji-palette", className)}>
            <Popover placement={placement}>
                <PopoverButton className="ghost grey">
                    <i className="fa-sharp fa-solid fa-face-smile"></i>
                </PopoverButton>
                <PopoverContent className="emoji-palette-content">
                    <InputGroup>
                        <InputLeftElement>
                            <i className="fa-sharp fa-solid fa-magnifying-glass"></i>
                        </InputLeftElement>
                        <Input placeholder="Search emojis..." value={searchTerm} onChange={handleSearchChange} />
                    </InputGroup>
                    <div className="emoji-grid">
                        {filteredEmojis.length > 0 ? (
                            filteredEmojis.map((item, index) => (
                                <Button key={index} className="ghost emoji-button" onClick={() => handleSelect(item)}>
                                    {item.emoji}
                                </Button>
                            ))
                        ) : (
                            <div className="no-emojis">No emojis found</div>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
});

EmojiPalette.displayName = "EmojiPalette";

export { EmojiPalette };
export type { EmojiItem };
