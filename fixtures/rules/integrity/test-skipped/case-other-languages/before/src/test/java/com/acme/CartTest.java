package com.acme;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class CartTest {
    @Test
    void addsPrices() {
        assertEquals(3, Cart.total(1, 2));
    }

    @Test
    void usesPosixPaths() {
        assertEquals("a/b", Cart.path("a", "b"));
    }
}
