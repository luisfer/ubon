package com.acme;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;

class CartTest {
    @Test
    @Disabled("fails after the currency change") // expect-block: integrity/test-skipped
    void addsPrices() {
        assertEquals(3, Cart.total(1, 2));
    }

    @Test
    // ok: DisabledOnOs is a platform condition, not a blanket skip
    @DisabledOnOs(OS.WINDOWS)
    void usesPosixPaths() {
        assertEquals("a/b", Cart.path("a", "b"));
    }
}
