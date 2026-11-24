"use client";

import { useEffect } from "react";

// Lekcja 7 (Standard): przycisk „Wstecz” po wylogowaniu nie może pokazać starych danych.
// Przeglądarka (zwłaszcza Safari) potrafi przywrócić stronę z pamięci bez pytania serwera.
// Wtedy przeładowujemy ją – serwer i proxy.ts sprawdzą sesję (bez sesji → /login).
export default function BackForwardGuard() {
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  return null;
}
