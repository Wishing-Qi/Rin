import { XMLBuilder, XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    trimValues: true
});

const builder = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    format: true
});

export type XMLRPCValue = 
    | { string: [{ "#text": string }] }
    | { int: [{ "#text": number }] }
    | { i4: [{ "#text": number }] }
    | { double: [{ "#text": number }] }
    | { boolean: [{ "#text": string }] } // "0" or "1"
    | { dateTime\.iso8601: [{ "#text": string }] }
    | { base64: [{ "#text": string }] }
    | { struct: { member: XMLRPCMember[] }[] }
    | { array: { data: { value: XMLRPCValue[] }[] }[] };

type XMLRPCMember = {
    name: [{ "#text": string }],
    value: [XMLRPCValue]
};

/**
 * 将 XML-RPC 的抽象语法树转换为简单的 JSON 对象
 */
export function xmlrpcToJSON(xml: string) {
    const obj = parser.parse(xml);
    const methodCall = obj.find((n: any) => n.methodCall);
    if (!methodCall) throw new Error("Invalid XML-RPC: missing methodCall");

    const methodNameNode = methodCall.methodCall.find((n: any) => n.methodName);
    const methodName = methodNameNode.methodName[0]["#text"];

    const paramsNode = methodCall.methodCall.find((n: any) => n.params);
    const params = paramsNode ? paramsNode.params.map((p: any) => {
        const valueNode = p.param[0].value[0];
        return parseValue(valueNode);
    }) : [];

    return { methodName, params };
}

function parseValue(node: any): any {
    const type = Object.keys(node)[0];
    const val = node[type][0]["#text"];

    switch (type) {
        case "string": return val || "";
        case "int":
        case "i4": return parseInt(val);
        case "double": return parseFloat(val);
        case "boolean": return val === "1";
        case "struct":
            const struct: any = {};
            node.struct[0].member.forEach((m: any) => {
                const name = m.name[0]["#text"];
                struct[name] = parseValue(m.value[0]);
            });
            return struct;
        case "array":
            return node.array[0].data[0].value.map((v: any) => parseValue(v));
        default: return val;
    }
}

/**
 * 将 JSON 对象转换为 XML-RPC 响应格式
 */
export function jsonToXmlrpcResponse(data: any): string {
    const value = formatValue(data);
    const obj = [
        {
            methodResponse: [
                {
                    params: [
                        {
                            param: [
                                { value: [value] }
                            ]
                        }
                    ]
                }
            ]
        }
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(obj)}`;
}

export function jsonToXmlrpcFault(code: number, message: string): string {
    const fault = {
        struct: [
            {
                member: [
                    { name: [{ "#text": "faultCode" }], value: [{ int: [{ "#text": code }] }] },
                    { name: [{ "#text": "faultString" }], value: [{ string: [{ "#text": message }] }] }
                ]
            }
        ]
    };
    const obj = [
        {
            methodResponse: [
                { fault: [{ value: [fault] }] }
            ]
        }
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(obj)}`;
}

function formatValue(data: any): any {
    if (typeof data === "string") return { string: [{ "#text": data }] };
    if (typeof data === "number") {
        if (Number.isInteger(data)) return { int: [{ "#text": data }] };
        return { double: [{ "#text": data }] };
    }
    if (typeof data === "boolean") return { boolean: [{ "#text": data ? "1" : "0" }] };
    if (data instanceof Date) return { "dateTime.iso8601": [{ "#text": data.toISOString() }] };
    if (Array.isArray(data)) {
        return {
            array: [
                {
                    data: [
                        { value: data.map(v => formatValue(v)) }
                    ]
                }
            ]
        };
    }
    if (typeof data === "object" && data !== null) {
        const members = Object.entries(data).map(([name, val]) => ({
            member: [
                { name: [{ "#text": name }], value: [formatValue(val)] }
            ]
        }));
        return { struct: members };
    }
    return { string: [{ "#text": String(data) }] };
}
