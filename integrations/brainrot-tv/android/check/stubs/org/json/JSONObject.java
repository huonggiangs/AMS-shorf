package org.json;

import java.util.LinkedHashMap;
import java.util.Map;

/** STUB with a small real parser (same observable behaviour as Android's org.json for what the AMS code uses). */
public class JSONObject {
    public static final Object NULL = new Object() {
        @Override public boolean equals(Object o) { return o == this || o == null; }
        @Override public int hashCode() { return 0; }
        @Override public String toString() { return "null"; }
    };
    final Map<String, Object> map = new LinkedHashMap<>();

    public JSONObject() { }
    public JSONObject(String json) throws JSONException {
        Object v = new Parser(json).parseValue();
        if (!(v instanceof JSONObject)) throw new JSONException("not an object");
        map.putAll(((JSONObject) v).map);
    }
    public JSONObject put(String k, Object v) throws JSONException { map.put(k, v == null ? NULL : v); return this; }
    public JSONObject put(String k, boolean v) throws JSONException { return put(k, (Object) Boolean.valueOf(v)); }
    public JSONObject put(String k, int v) throws JSONException { return put(k, (Object) Integer.valueOf(v)); }
    public JSONObject put(String k, long v) throws JSONException { return put(k, (Object) Long.valueOf(v)); }
    public JSONObject put(String k, double v) throws JSONException { return put(k, (Object) Double.valueOf(v)); }
    public boolean has(String k) { return map.containsKey(k); }
    public boolean isNull(String k) { Object v = map.get(k); return v == null || v == NULL; }
    public Object opt(String k) { return map.get(k); }
    public String optString(String k) { return optString(k, ""); }
    public String optString(String k, String d) { Object v = map.get(k); return v == null || v == NULL ? d : v.toString(); }
    public int optInt(String k, int d) { Object v = map.get(k); return v instanceof Number ? ((Number) v).intValue() : v instanceof String ? parseInt((String) v, d) : d; }
    public long optLong(String k, long d) { Object v = map.get(k); return v instanceof Number ? ((Number) v).longValue() : d; }
    public boolean optBoolean(String k, boolean d) { Object v = map.get(k); return v instanceof Boolean ? (Boolean) v : d; }
    public JSONObject optJSONObject(String k) { Object v = map.get(k); return v instanceof JSONObject ? (JSONObject) v : null; }
    public JSONArray optJSONArray(String k) { Object v = map.get(k); return v instanceof JSONArray ? (JSONArray) v : null; }
    private static int parseInt(String s, int d) { try { return Integer.parseInt(s.trim()); } catch (Exception e) { return d; } }

    @Override public String toString() {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : map.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append(quote(e.getKey())).append(':').append(write(e.getValue()));
        }
        return sb.append('}').toString();
    }

    static String write(Object v) {
        if (v == null || v == NULL) return "null";
        if (v instanceof String) return quote((String) v);
        return v.toString();
    }

    static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default: if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    static final class Parser {
        private final String s; private int i;
        Parser(String s) { this.s = s; }
        Object parseValue() throws JSONException {
            ws();
            if (i >= s.length()) throw new JSONException("eof");
            char c = s.charAt(i);
            if (c == '{') return obj();
            if (c == '[') return arr();
            if (c == '"') return str();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return NULL; }
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            String n = s.substring(st, i);
            if (n.isEmpty()) throw new JSONException("bad token at " + i);
            try { return n.contains(".") || n.contains("e") || n.contains("E") ? (Object) Double.valueOf(n) : (Object) Long.valueOf(n); }
            catch (NumberFormatException e) { throw new JSONException(n); }
        }
        private JSONObject obj() throws JSONException {
            JSONObject o = new JSONObject(); i++; ws();
            if (s.charAt(i) == '}') { i++; return o; }
            while (true) {
                ws(); String k = str(); ws();
                if (s.charAt(i++) != ':') throw new JSONException("expected :");
                o.map.put(k, parseValue()); ws();
                char c = s.charAt(i++);
                if (c == '}') return o;
                if (c != ',') throw new JSONException("expected ,");
            }
        }
        private JSONArray arr() throws JSONException {
            JSONArray a = new JSONArray(); i++; ws();
            if (s.charAt(i) == ']') { i++; return a; }
            while (true) {
                a.list.add(parseValue()); ws();
                char c = s.charAt(i++);
                if (c == ']') return a;
                if (c != ',') throw new JSONException("expected ,");
            }
        }
        private String str() throws JSONException {
            if (s.charAt(i) != '"') throw new JSONException("expected string at " + i);
            i++; StringBuilder sb = new StringBuilder();
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return sb.toString();
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n': sb.append('\n'); break; case 'r': sb.append('\r'); break; case 't': sb.append('\t'); break;
                        case 'b': sb.append('\b'); break; case 'f': sb.append('\f'); break;
                        case 'u': sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: sb.append(e);
                    }
                } else sb.append(c);
            }
        }
        private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
    }
}
