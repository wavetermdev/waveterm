// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useState } from "react";

import "./ratingbubble.scss";

interface RatingBubbleProps {
    notification: NotificationType;
    onRemove: (id: string) => void;
}

const RatingBubble = ({ notification, onRemove }: RatingBubbleProps) => {
    const { id, title, message } = notification;
    const [hoveredButtons, setHoveredButtons] = useState<{ [key: number]: boolean }>({});

    const handleRatingClick = (id, rating: number) => {
        console.log("rating clicked");
        onRemove(id);
    };

    const handleMouseEnter = (buttonIndex: number) => {
        setHoveredButtons((prev) => ({ ...prev, [buttonIndex]: true }));
    };

    const handleMouseLeave = (buttonIndex: number) => {
        setHoveredButtons((prev) => ({ ...prev, [buttonIndex]: false }));
    };

    return (
        <div className={clsx("notification-rating-bubble")} title="Click to Copy Notification Message">
            <Button
                className="close-btn ghost grey vertical-padding-10"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove(id);
                }}
                aria-label="Close"
            >
                <i className={clsx(makeIconClass("close", false))}></i>
            </Button>
            <div className="notification-inner">
                {title && <div className={clsx("notification-title green")}>{title}</div>}
                {message && <div className="notification-message">{message}</div>}
                <div className="actions-wrapper">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rating) => (
                        <Button
                            key={rating}
                            className={clsx("border-radius-4", hoveredButtons[rating] ? "green" : "grey")}
                            onClick={() => handleRatingClick(id, rating)}
                            onMouseEnter={() => handleMouseEnter(rating)}
                            onMouseLeave={() => handleMouseLeave(rating)}
                        >
                            {rating}
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export { RatingBubble };
