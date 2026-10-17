package com.pranix.quietkeep.plugins;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** DRV-06: the native write path refuses anything not on the read-only allow-list. */
public class ObdAllowListTest {

    @Test
    public void refusesWritesAndUnknownCommands() {
        String[] refused = { "04", "0400", "0 4", "AT@3 QKTEST", "ATSH 7E0", "ATBRD 23", "ATMA",
            "ATPP 01 ON", "ATSD 12", "2E F1 90 00", "22 F1 90", "10 03", "14 FF FF FF", "07", "hello", "", null };
        for (String c : refused) assertFalse("should refuse: " + c, QkObdPlugin.isAllowedReadOnly(c));
    }

    @Test
    public void allowsTheReadsTheReaderUses() {
        String[] allowed = { "ATZ", "AT E0", "atl0", "ATS0", "ATH1", "ATSP0", "ATDPN", "ATRV",
            "0100", "010C", "01 0D", "010C1", "03", "0902" };
        for (String c : allowed) assertTrue("should allow: " + c, QkObdPlugin.isAllowedReadOnly(c));
    }
}
