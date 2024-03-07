import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import dayjs from "dayjs";
import cs from "classnames";
import { Button } from "@/elements";
import { If } from "tsx-control-statements/components";

import "./datepicker.less";

interface YearRefs {
    [key: number]: React.RefObject<HTMLDivElement>;
}

type DatePickerProps = {
    selectedDate: Date;
    onSelectDate: (date: Date) => void;
};

const DatePicker: React.FC<DatePickerProps> = ({ selectedDate, onSelectDate }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selDate, setSelDate] = useState(dayjs(selectedDate)); // Initialize with dayjs object
    const [showYearAccordion, setShowYearAccordion] = useState(false);
    const [expandedYear, setExpandedYear] = useState<number | null>(selDate.year());
    const yearRefs = useRef<YearRefs>({});
    const wrapperRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);

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

    const handleClickOutside = (event: MouseEvent) => {
        // Check if the click is outside both the wrapper and the menu
        if (
            wrapperRef.current &&
            !wrapperRef.current.contains(event.target as Node) &&
            modalRef.current &&
            !modalRef.current.contains(event.target as Node)
        ) {
            setIsOpen(false);
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

    return (
        <div ref={wrapperRef}>
            <div className="day-picker-input" onClick={toggleModal}>
                <div>{selDate.format("YYYY-MM-DD")}</div>
                <i className="fa-sharp fa-regular fa-calendar"></i>
            </div>
            {dayPickerModal}
        </div>
    );
};

export { DatePicker };
