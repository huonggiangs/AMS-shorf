package com.google.zxing.common;
public final class BitMatrix { public boolean get(int x, int y) { return ((x ^ y) & 1) == 0; } }
