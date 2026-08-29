"use client";
import { useEffect, useState } from "react";
import { minutesNow } from "./format";
/** 実時計。既定は30秒ごと。分未満の精度は要らない */
export function useNow(intervalMs = 30_000) {
    const [now, setNow] = useState(() => minutesNow());
    useEffect(() => {
        const id = setInterval(() => setNow(minutesNow()), intervalMs);
        const onVisible = () => document.visibilityState === "visible" && setNow(minutesNow());
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [intervalMs]);
    return now;
}
