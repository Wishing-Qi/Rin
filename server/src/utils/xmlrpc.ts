import { XMLBuilder, XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    parseTagValue: false // 重要：避免将 ID 字符串自动转为数字
});

const builder = new XMLBuilder({
    ignoreAttributes: true,
    format: true
});

/**
 * 将 XML-RPC 的抽象语法树转换为简单的 JSON 对象
 */
export function xmlrpcToJSON(xml: string) {
    const obj = parser.parse(xml);
    
    if (!obj.methodCall) throw new Error("Invalid XML-RPC: missing methodCall");

    const methodName = obj.methodCall.methodName;
    const paramsWrapper = obj.methodCall.params;
    
    let params: any[] = [];
    if (paramsWrapper && paramsWrapper.param) {
        const paramArray = Array.isArray(paramsWrapper.param) ? paramsWrapper.param : [paramsWrapper.param];
        params = paramArray.map((p: any) => parseValue(p.value));
    }

    return { methodName, params };
}

function parseValue(valueNode: any): any {
    if (valueNode === undefined || valueNode === null) return "";
    
    // 如果 value 节点直接包含文本（有些客户端不带类型标签）
    if (typeof valueNode !== 'object') return valueNode;

    const type = Object.keys(valueNode)[0];
    const val = valueNode[type];

    switch (type) {
        case "string": return String(val === undefined ? "" : val);
        case "int":
        case "i4": return parseInt(val);
        case "double": return parseFloat(val);
        case "boolean": return val === "1" || val === 1 || val === true;
        case "struct":
            const struct: any = {};
            if (val && val.member) {
                const members = Array.isArray(val.member) ? val.member : [val.member];
                members.forEach((m: any) => {
                    struct[m.name] = parseValue(m.value);
                });
            }
            return struct;
        case "array":
            if (val && val.data && val.data.value) {
                const values = Array.isArray(val.data.value) ? val.data.value : [val.data.value];
                return values.map((v: any) => parseValue(v));
            }
            return [];
        case "base64": return val;
        default: 
            // 处理没有显式类型标签的情况
            if (type === undefined) return "";
            return val;
    }
}

/**
 * 将 JSON 对象转换为 XML-RPC 响应格式
 */
export function jsonToXmlrpcResponse(data: any): string {
    const obj = {
        methodResponse: {
            params: {
                param: {
                    value: formatValue(data)
                }
            }
        }
    };
    return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(obj)}`;
}

export function jsonToXmlrpcFault(code: number, message: string): string {
    const obj = {
        methodResponse: {
            fault: {
                value: {
                    struct: {
                        member: [
                            { name: "faultCode", value: { int: code } },
                            { name: "faultString", value: { string: message } }
                        ]
                    }
                }
            }
        }
    };
    return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(obj)}`;
}

function formatValue(data: any): any {
    if (data === null || data === undefined) return { string: "" };
    if (typeof data === "string") return { string: data };
    if (typeof data === "number") {
        if (Number.isInteger(data)) return { int: data };
        return { double: data };
    }
    if (typeof data === "boolean") return { boolean: data ? "1" : "0" };
    if (data instanceof Date || (typeof data === 'object' && typeof data.toISOString === 'function')) return { "dateTime.iso8601": data.toISOString() };
    if (Array.isArray(data)) {
        return {
            array: {
                data: {
                    value: data.map(v => formatValue(v))
                }
            }
        };
    }
    if (typeof data === "object") {
        const members = Object.entries(data).map(([name, val]) => ({
            name,
            value: formatValue(val)
        }));
        return { struct: { member: members } };
    }
    return { string: String(data) };
}

