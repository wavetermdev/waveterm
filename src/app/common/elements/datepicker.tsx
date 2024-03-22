import React, { useState, useEffect, useRef, createRef } from "react";
import * as mobx from "mobx";
import ReactDOM from "react-dom";
import dayjs from "dayjs";
import cs from "classnames";
import { Button } from "@/elements";
import { If } from "tsx-control-statements/components";
import { GlobalModel } from "@/models";
import { v4 as uuidv4 } from "uuid";

import "./datepicker.less";

interface YearRefs {
    [key: number]: React.RefObject<HTMLDivElement>;
}

type DatePickerProps = {
    selectedDate: Date;
    onSelectDate: (date: Date) => void;
    format?: string;
};

const DatePicker: React.FC<DatePickerProps> = ({ selectedDate, format = "MM/DD/YYYY", onSelectDate }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selDate, setSelDate] = useState(dayjs(selectedDate)); // Initialize with dayjs object
    const [showYearAccordion, setShowYearAccordion] = useState(false);
    const [expandedYear, setExpandedYear] = useState<number | null>(selDate.year());
    const yearRefs = useRef<YearRefs>({});
    const wrapperRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const calendarIconRef = useRef(null);
    const inputRefs = useRef({ YYYY: null, MM: null, DD: null });
    // Extract delimiter using regex
    const delimiter = format.replace(/[0-9YMD]/g, "")[0] || "/";
    // Split format and create state for each part
    const formatParts = format.split(delimiter);
    const [dateParts, setDateParts] = useState({
        YYYY: selDate.format("YYYY"),
        MM: selDate.format("MM"),
        DD: selDate.format("DD"),
    });
    let curUuid = uuidv4();

    useEffect(() => {
        inputRefs.current = {
            YYYY: createRef(),
            MM: createRef(),
            DD: createRef(),
        };
    }, []);

    useEffect(() => {
        if (showYearAccordion && expandedYear && yearRefs.current[expandedYear]) {
            yearRefs.current[expandedYear].current?.scrollIntoView({
                block: "nearest",
            });
        }
    }, [showYearAccordion, expandedYear]);

    useEffect(() => {
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        setDateParts({
            YYYY: selDate.format("YYYY"),
            MM: selDate.format("MM"),
            DD: selDate.format("DD"),
        });
    }, [selDate]);

    const handleClickOutside = (event: MouseEvent) => {
        // Check if the click is on the calendar icon
        if (calendarIconRef.current && calendarIconRef.current.contains(event.target as Node)) {
            // Click is on the calendar icon, do nothing
            return;
        }

        // Check if the click is outside the modal
        if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
            setIsOpen(false); // Close the modal
        }
    };

    const handleDayClick = (date: Date) => {
        const newDate = dayjs(date);
        setSelDate(newDate); // Update selDate with the new dayjs object
        onSelectDate && onSelectDate(date); // Call parent's onSelectDate
        setIsOpen(false); // Close the picker
    };

    const changeMonth = (delta: number) => {
        const newDate = selDate.add(delta, "month");
        setSelDate(newDate);
        onSelectDate && onSelectDate(newDate.toDate());
    };

    const renderHeader = () => {
        return (
            <div className="day-picker-header">
                <div
                    className={cs({ fade: showYearAccordion })}
                    onClick={() => {
                        if (!showYearAccordion) {
                            setExpandedYear(selDate.year()); // Set expandedYear when opening accordion
                        }
                        setShowYearAccordion(!showYearAccordion);
                    }}
                >
                    {selDate.format("MMMM YYYY")}
                    <span className={cs("dropdown-arrow", { fade: showYearAccordion })}></span>
                </div>
                <If condition={!showYearAccordion}>
                    <div className="arrows">
                        <Button className="secondary ghost" onClick={() => changeMonth(-1)}>
                            &uarr;
                        </Button>
                        <Button className="secondary ghost" onClick={() => changeMonth(1)}>
                            &darr;
                        </Button>
                    </div>
                </If>
            </div>
        );
    };

    const renderDayHeaders = () => {
        const daysOfWeek = ["S", "M", "T", "W", "T", "F", "S"]; // First letter of each day
        return (
            <div className="day-header">
                {daysOfWeek.map((day, i) => (
                    <div key={`${day}-${i}`} className="day-header-cell">
                        {day}
                    </div>
                ))}
            </div>
        );
    };

    const renderDays = () => {
        const days = [];
        const startDay = selDate.startOf("month");
        const endDay = selDate.endOf("month");
        const startDate = startDay.day(); // 0 for Sunday, 1 for Monday, ..., 6 for Saturday

        // Previous month's filler days
        const previousMonth = startDay.subtract(1, "month");
        const daysInPreviousMonth = previousMonth.daysInMonth();
        for (let i = daysInPreviousMonth - startDate + 1; i <= daysInPreviousMonth; i++) {
            const dayDate = previousMonth.date(i);
            days.push(
                <div
                    key={`prev-month-day-${i}`}
                    className="day other-month"
                    onClick={() => handleDayClick(dayDate.toDate())}
                >
                    {i}
                </div>
            );
        }

        // Current month's days
        for (
            let dayCount = 1;
            startDay.add(dayCount - 1, "day").isBefore(endDay) ||
            startDay.add(dayCount - 1, "day").isSame(endDay, "day");
            dayCount++
        ) {
            const currentDate = startDay.add(dayCount - 1, "day");
            days.push(
                <div
                    key={dayCount}
                    className={`day ${selDate.isSame(currentDate, "day") ? "selected" : ""}`}
                    onClick={() => handleDayClick(currentDate.toDate())}
                >
                    {dayCount}
                </div>
            );
        }

        // Next month's filler days
        while (days.length < 42) {
            const fillerDayCount = days.length - daysInPreviousMonth - endDay.date();
            const dayDate = endDay.add(fillerDayCount + 1, "day");
            days.push(
                <div
                    key={`next-month-day-${dayDate.format("YYYY-MM-DD")}`}
                    className="day other-month"
                    onClick={() => handleDayClick(dayDate.toDate())}
                >
                    {dayDate.date()}
                </div>
            );
        }

        return days;
    };

    const calculatePosition = (): React.CSSProperties => {
        if (wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            return {
                position: "absolute",
                top: `${rect.bottom + window.scrollY + 2}px`,
                left: `${rect.left + window.scrollX}px`,
            };
        }
        return {};
    };

    const populateYears = () => {
        const currentYear = dayjs().year();
        const startYear = currentYear - 10;
        const endYear = currentYear + 10;
        const yearsRange = [];

        for (let year = startYear; year <= endYear; year++) {
            yearsRange.push(year);
            yearRefs.current[year] = React.createRef();
        }

        return yearsRange;
    };

    const handleMonthYearSelect = (month: number, year: number) => {
        const newDate = dayjs(new Date(year, month - 1));
        setSelDate(newDate);
        setShowYearAccordion(false); // Close accordion
        onSelectDate && onSelectDate(newDate.toDate());
    };

    const renderYearMonthAccordion = () => {
        const years = populateYears();
        const currentYear = selDate.year();

        return (
            <div className="year-month-accordion-wrapper">
                <div className="year-month-accordion">
                    {years.map((year) => (
                        <div key={year} ref={yearRefs.current[year]}>
                            <div
                                className="year-header"
                                data-year={year}
                                onClick={() => setExpandedYear(year === expandedYear ? null : year)}
                            >
                                {year}
                            </div>
                            <If condition={expandedYear === year}>
                                <div
                                    className={cs("month-container", {
                                        expanded: expandedYear === year,
                                    })}
                                >
                                    {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                                        <div
                                            key={month}
                                            className={cs("month", {
                                                selected: year === currentYear && month === selDate.month() + 1,
                                            })}
                                            onClick={() => handleMonthYearSelect(month, year)}
                                        >
                                            {dayjs(new Date(year, month - 1)).format("MMM")}
                                        </div>
                                    ))}
                                </div>
                            </If>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const toggleModal = () => {
        setIsOpen((prevIsOpen) => !prevIsOpen);
        setShowYearAccordion(false);
    };

    const dayPickerModal = isOpen
        ? ReactDOM.createPortal(
              <div ref={modalRef} className="day-picker-modal" style={calculatePosition()}>
                  {renderHeader()}
                  {showYearAccordion && renderYearMonthAccordion()}
                  <If condition={!showYearAccordion}>
                      <>
                          {renderDayHeaders()}
                          <div className="day-picker">{renderDays()}</div>
                      </>
                  </If>
              </div>,
              document.getElementById("app")!
          )
        : null;

    const handleDatePartChange = (part, value) => {
        const newDateParts = { ...dateParts, [part]: value };
        setDateParts(newDateParts);

        // Construct a new date from the updated parts
        const newDate = dayjs(`${newDateParts.YYYY}-${newDateParts.MM}-${newDateParts.DD}`);
        if (newDate.isValid()) {
            onSelectDate(newDate.toDate()); // Call onSelectDate with the new date
        }
    };

    const handleArrowNavigation = (key, currentPart) => {
        const currentIndex = formatParts.indexOf(currentPart);
        let targetInput;

        if (key == "ArrowLeft" && currentIndex > 0) {
            targetInput = inputRefs.current[formatParts[currentIndex - 1]].current;
        } else if (key == "ArrowRight" && currentIndex < formatParts.length - 1) {
            targetInput = inputRefs.current[formatParts[currentIndex + 1]].current;
        }

        if (targetInput) {
            targetInput.focus();
        }
    };

    const handleKeyDown = (event, currentPart) => {};

    const handleFocus = (event, part) => {
        event.target.select();
        registerKeybindings(event, part);
    };

    const registerKeybindings = (event: any, part: string) => {
        let keybindManager = GlobalModel.keybindManager;
        let domain = "datepicker-" + curUuid + "-" + part;
        keybindManager.registerKeybinding("control", domain, "generic:selectLeft", (waveEvent) => {
            handleArrowNavigation("ArrowLeft", part);
            return true;
        });
        keybindManager.registerKeybinding("control", domain, "generic:selectRight", (waveEvent) => {
            handleArrowNavigation("ArrowRight", part);
            return true;
        });
        keybindManager.registerKeybinding("control", domain, "generic:space", (waveEvent) => {
            toggleModal();
            return true;
        });
        keybindManager.registerKeybinding("control", domain, "generic:tab", (waveEvent) => {
            handleArrowNavigation("ArrowRight", part);
            return true;
        });
        for (let numpadKey = 0; numpadKey <= 9; numpadKey++) {
            keybindManager.registerKeybinding(
                "control",
                domain,
                "generic:numpad-" + numpadKey.toString(),
                (waveEvent) => {
                    let currentPart = part;
                    const maxLength = currentPart === "YYYY" ? 4 : 2;
                    const newValue = event.target.value.length < maxLength ? event.target.value + numpadKey : numpadKey;
                    let selectionTimeoutId = null;
                    handleDatePartChange(currentPart, newValue);

                    // Clear any existing timeout
                    if (selectionTimeoutId !== null) {
                        clearTimeout(selectionTimeoutId);
                    }

                    // Re-focus and select the input after state update
                    selectionTimeoutId = setTimeout(() => {
                        event.target.focus();
                        event.target.select();
                    }, 0);
                    return true;
                }
            );
        }
    };

    const handleBlur = (event, part) => {
        unregisterKeybindings(part);
    };

    const unregisterKeybindings = (part) => {
        let domain = "datepicker-" + curUuid + "-" + part;
        GlobalModel.keybindManager.unregisterDomain(domain);
    };

    // Prevent use from selecting text in the input
    const handleMouseDown = (event, part) => {
        event.preventDefault();

        handleFocus(event, part);
    };

    const handleIconKeyDown = (event) => {
        if (event.key === "Enter") {
            toggleModal();
        }
    };

    const setInputWidth = (inputRef, value) => {
        const span = document.createElement("span");
        document.body.appendChild(span);
        span.style.font = "inherit";
        span.style.visibility = "hidden";
        span.style.position = "absolute";
        span.textContent = value;
        const textWidth = span.offsetWidth;
        document.body.removeChild(span);

        if (inputRef.current) {
            inputRef.current.style.width = `${textWidth}px`;
        }
    };

    useEffect(() => {
        // This timeout ensures that the effect runs after the DOM updates
        const timeoutId = setTimeout(() => {
            formatParts.forEach((part) => {
                const inputRef = inputRefs.current[part];
                if (inputRef && inputRef.current) {
                    setInputWidth(inputRef, dateParts[part]);
                }
            });
        }, 0);

        return () => clearTimeout(timeoutId); // Cleanup timeout on unmount
    }, []);

    const renderDatePickerInput = () => {
        return (
            <div className="day-picker-input">
                {formatParts.map((part, index) => {
                    const inputRef = inputRefs.current[part];

                    return (
                        <React.Fragment key={part}>
                            {index > 0 && <span>{delimiter}</span>}
                            <input
                                readOnly
                                ref={inputRef}
                                type="text"
                                value={dateParts[part]}
                                onChange={(e) => handleDatePartChange(part, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, part)}
                                onMouseDown={(e) => handleMouseDown(e, part)}
                                onFocus={(e) => handleFocus(e, part)}
                                onBlur={(e) => handleBlur(e, part)}
                                maxLength={part === "YYYY" ? 4 : 2}
                                className="date-input"
                                placeholder={part}
                            />
                        </React.Fragment>
                    );
                })}
                <i
                    ref={calendarIconRef}
                    className="fa-sharp fa-regular fa-calendar"
                    onClick={toggleModal}
                    onKeyDown={handleIconKeyDown}
                    tabIndex={0} // Makes the icon focusable
                    role="button" // Semantic role for accessibility
                    aria-label="Toggle date picker" // Accessible label for screen readers
                />
            </div>
        );
    };

    return (
        <div ref={wrapperRef}>
            {renderDatePickerInput()}
            {dayPickerModal}
        </div>
    );
};

export { DatePicker };
