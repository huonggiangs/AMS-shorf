package org.json;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/** STUB, see JSONObject. */
public class JSONArray {
    final List<Object> list = new ArrayList<>();
    public JSONArray() { }
    public JSONArray(Collection<?> c) { list.addAll(c); }
    public int length() { return list.size(); }
    public JSONArray put(Object v) { list.add(v == null ? JSONObject.NULL : v); return this; }
    public JSONObject optJSONObject(int i) { Object v = i >= 0 && i < list.size() ? list.get(i) : null; return v instanceof JSONObject ? (JSONObject) v : null; }
    public String optString(int i) { return optString(i, ""); }
    public String optString(int i, String d) { Object v = i >= 0 && i < list.size() ? list.get(i) : null; return v == null || v == JSONObject.NULL ? d : v.toString(); }
    @Override public String toString() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < list.size(); i++) { if (i > 0) sb.append(','); sb.append(JSONObject.write(list.get(i))); }
        return sb.append(']').toString();
    }
}
