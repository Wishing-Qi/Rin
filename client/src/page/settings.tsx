import * as Switch from '@radix-ui/react-switch';
import {ChangeEvent, useContext, useEffect, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import ReactLoading from "react-loading";
import Modal from "react-modal";
import {Button} from "../components/button.tsx";
import {useAlert, useConfirm} from "../components/dialog.tsx";
import {client, oauth_url} from "../main.tsx";
import {
    ClientConfigContext,
    ConfigWrapper,
    defaultClientConfig,
    defaultClientConfigWrapper,
    defaultServerConfig,
    defaultServerConfigWrapper,
    ServerConfigContext
} from "../state/config.tsx";
import {headersWithAuth} from "../utils/auth.ts";
import {ProfileContext} from "../state/profile.tsx";
import '../utils/thumb.css';


export function Settings() {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [msg, setMsg] = useState('');
    const [msgList, setMsgList] = useState<{ title: string, reason: string }[]>([]);
    const [clientLoading, setClientLoading] = useState(true);
    const [serverLoading, setServerLoading] = useState(true);
    const [clientConfig, setClientConfig] = useState<ConfigWrapper>(defaultClientConfigWrapper);
    const [serverConfig, setServerConfig] = useState<ConfigWrapper>(defaultServerConfigWrapper);
    const ref = useRef(false);
    const { showAlert, AlertUI } = useAlert();


    useEffect(() => {
        if (ref.current) return;
        client.config({
            type: 'client'
        }).get({
            headers: headersWithAuth()
        }).then(({ data }) => {
            if (data && typeof data !== 'string') {
                sessionStorage.setItem('config', JSON.stringify(data));
                const config = new ConfigWrapper(data, defaultClientConfig)
                setClientConfig(config)
            }
        }).catch((err: any) => {
            showAlert(t('settings.get_config_failed$message', { message: err.message }))
        }).finally(() => {
            setClientLoading(false);
        })
        client.config({
            type: 'server'
        }).get({
            headers: headersWithAuth()
        }).then(({ data }) => {
            if (data && typeof data !== 'string') {
                const config = new ConfigWrapper(data, defaultServerConfig)
                setServerConfig(config)
            }
        }).catch((err) => {
            showAlert(t('settings.get_config_failed$message', { message: err.message }))
        }).finally(() => {
            setServerLoading(false);
        })
        ref.current = true;
    }, []);

    async function handleFaviconChange(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
            if (file.size > MAX_FILE_SIZE) {
                showAlert(
                    t("upload.failed$size", {
                        size: MAX_FILE_SIZE / 1024 / 1024,
                    }),
                );
                return;
            }
            await client.favicon
                .post(
                    {
                        file: file,
                    },
                    {
                        headers: headersWithAuth(),
                    },
                )
                .then(({ data }) => {
                    if (data && typeof data !== "string") {
                        showAlert(t("settings.favicon.update.success"));
                    }
                })
                .catch((err) => {
                    showAlert(
                        t("settings.favicon.update.failed$message", {
                            message: err.message,
                        }),
                    );
                });
        }
    }

    async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            await client.wp.post({
                data: file,
            }, {
                headers: headersWithAuth()
            }).then(({ data }) => {
                if (data && typeof data !== 'string') {
                    setMsg(t('settings.import_success$success$skipped', { success: data.success, skipped: data.skipped }))
                    setMsgList(data.skippedList)
                    setIsOpen(true);
                }
            }).catch((err) => {
                showAlert(t('settings.import_failed$message', { message: err.message }))
            })
        }
    }

    return (
        <div className="flex flex-col justify-center items-center">
            <ServerConfigContext.Provider value={serverConfig}>
                <ClientConfigContext.Provider value={clientConfig}>
                    <main className="wauto rounded-2xl bg-w m-2 p-6" aria-label={t("main_content")}>
                        <div className="flex flex-row items-center space-x-2">
                            <h1 className="text-2xl font-bold t-primary">
                                {t('settings.title')}
                            </h1>
                            {(clientLoading || serverLoading) && <ReactLoading width="1em" height="1em" type="spin" color="#8dd1d2" />}
                        </div>
                        <div className="flex flex-col items-start space-y-2">
                            <ItemTitle title={t('settings.friend.title')} />
                            <ItemSwitch title={t('settings.friend.apply.title')} description={t('settings.friend.apply.desc')} type="client" configKey="friend_apply_enable" />
                            <ItemSwitch title={t('settings.friend.health.title')} description={t('settings.friend.health.desc')} type="server" configKey="friend_crontab" />
                            <ItemInput title={t('settings.friend.health.ua.title')} description={t('settings.friend.health.ua.desc')} type="server" configKey="friend_ua" configKeyTitle="User-Agent" />
                            <ItemTitle title={t('settings.other.title')} />
                            <ItemSwitch title={t('settings.login.enable.title')} description={t('settings.login.enable.desc', {"url": oauth_url})} type="client" configKey="login.enabled" />
                            <ItemSwitch title={t('settings.comment.enable.title')} description={t('settings.comment.enable.desc')} type="client" configKey="comment.enabled" />
                            <ItemSwitch title={t('settings.counter.enable.title')} description={t('settings.counter.enable.desc')} type="client" configKey="counter.enabled" />
                            <ItemSwitch title={t('settings.rss.title')} description={t('settings.rss.desc')} type="client" configKey="rss" />
                            <ItemWithUpload
                                title={t("settings.favicon.title")}
                                description={t("settings.favicon.desc")}
                                // @see https://developers.cloudflare.com/images/transform-images/#supported-input-formats
                                accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                                onFileChange={handleFaviconChange}
                            />
                            <ItemInput title={t('settings.footer.title')} description={t('settings.footer.desc')} type="client" configKey="footer" configKeyTitle="Footer HTML" />
                            <ItemButton title={t('settings.cache.clear.title')} description={t('settings.cache.clear.desc')} buttonTitle={t('clear')} onConfirm={async () => {
                                await client.config.cache.delete(undefined, {
                                    headers: headersWithAuth()
                                })
                                    .then(({ error }: { error: any }) => {
                                        if (error) {
                                            showAlert(t('settings.cache.clear_failed$message', { message: error.message }))
                                        }
                                    })
                            }} alertTitle={t('settings.cache.clear.confirm.title')} alertDescription={t('settings.cache.clear.confirm.desc')} />
                            <ItemWithUpload title={t('settings.wordpress.title')} description={t('settings.wordpress.desc')}
                                accept="application/xml"
                                onFileChange={onFileChange} />
                            <ItemCleanup />
                            <ItemAPIKey />
                        </div>
                    </main>
                </ClientConfigContext.Provider>
            </ServerConfigContext.Provider>
            <Modal isOpen={isOpen}

                style={{
                    content: {
                        top: '50%',
                        left: '50%',
                        right: 'auto',
                        bottom: 'auto',
                        marginRight: '-50%',
                        transform: 'translate(-50%, -50%)',
                        padding: '0',
                        border: 'none',
                        borderRadius: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        background: 'transparent',
                    },
                    overlay: {
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        zIndex: 1000
                    }
                }}
            >
                <div className="flex flex-col items-start p-4 bg-w">
                    <h1 className="text-2xl font-bold t-primary">
                        {t('settings.import_result')}
                    </h1>
                    <p className="text-base dark:text-white">
                        {msg}
                    </p>
                    <div className="flex flex-col items-start w-full">
                        <p className="text-base font-bold dark:text-white mt-2">
                            {t('settings.import_skipped')}
                        </p>
                        <ul className="flex flex-col items-start max-h-64 overflow-auto w-full">
                            {msgList.map((msg, idx) => (
                                <p key={idx} className="text-sm dark:text-white">
                                    {t('settings.import_skipped_item$title$reason', { title: msg.title, reason: msg.reason })}
                                </p>
                            ))}
                        </ul>
                    </div>
                    <div className="w-full flex flex-col items-center mt-4">
                        <button onClick={() => {
                            setIsOpen(false);
                        }} className="bg-theme text-white rounded-xl px-8 py-2 h-min">
                            {t('close')}
                        </button>
                    </div>
                </div>
            </Modal>
            <AlertUI />
        </div>
    );
}

function ItemCleanup() {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [allFiles, setAllFiles] = useState<{ key: string, url: string, isException?: boolean }[]>([]);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [viewMode, setViewMode] = useState<'cleanup' | 'exceptions'>('cleanup');
    const { showAlert, AlertUI } = useAlert();

    async function fetchUnusedFiles() {
        setLoading(true);
        try {
            const { data } = await client.storage.cleanup.get({
                query: { excludeExceptions: 'false' },
                headers: headersWithAuth()
            }) as any;
            if (Array.isArray(data)) {
                setAllFiles(data);
                setIsOpen(true);
            }
        } catch (e: any) {
            showAlert(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleCleanup() {
        const keysToDelete = Array.from(selectedKeys).filter(key => {
            const file = allFiles.find(f => f.key === key);
            return file && !file.isException;
        });
        if (keysToDelete.length === 0) return;
        setLoading(true);
        try {
            const { data } = await client.storage.cleanup.post({
                keys: keysToDelete
            }, {
                headers: headersWithAuth()
            }) as any;
            showAlert(data.message);
            setIsOpen(false);
            setSelectedKeys(new Set());
        } catch (e: any) {
            showAlert(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function toggleException(key: string) {
        const config = useContext(ServerConfigContext);
        const currentExceptions = config.get<string>('storage.cleanup.exceptions') || '';
        const file = allFiles.find(f => f.key === key);
        if (!file) return;

        const lines = currentExceptions.split('\n').filter((s: string) => s.trim());
        const keyPart = key.includes('/') ? key.split('/').pop() || key : key;

        let newExceptions: string;
        if (file.isException) {
            const newLines = lines.filter((l: string) => !key.includes(l.trim()));
            newExceptions = newLines.join('\n');
        } else {
            lines.push(keyPart);
            newExceptions = lines.join('\n');
        }

        await client.config({ type: 'server' }).post({ 'storage.cleanup.exceptions': newExceptions }, {
            headers: headersWithAuth()
        });

        await fetchUnusedFiles();
    }

    const cleanupFiles = allFiles.filter(f => !f.isException);
    const exceptionFiles = allFiles.filter(f => f.isException);
    const currentFiles = viewMode === 'cleanup' ? cleanupFiles : exceptionFiles;
    const visibleSelectedCount = Array.from(selectedKeys).filter(key => {
        const file = allFiles.find(f => f.key === key);
        return viewMode === 'cleanup' ? (file && !file.isException) : (file && file.isException);
    }).length;
    const allVisibleSelected = currentFiles.length > 0 && currentFiles.every(f => selectedKeys.has(f.key));

    function toggleSelectAll() {
        const newSelected = new Set(selectedKeys);
        if (allVisibleSelected) {
            currentFiles.forEach(f => newSelected.delete(f.key));
        } else {
            currentFiles.forEach(f => newSelected.add(f.key));
        }
        setSelectedKeys(newSelected);
    }

    function toggleSelect(key: string) {
        const newSelected = new Set(selectedKeys);
        if (newSelected.has(key)) {
            newSelected.delete(key);
        } else {
            newSelected.add(key);
        }
        setSelectedKeys(newSelected);
    }

    return (
        <div className="flex flex-col w-full items-start py-2">
            <div className="flex flex-row justify-between w-full items-center">
                <div className="flex flex-col">
                    <p className="text-lg font-bold dark:text-white">清理未使用文件</p>
                    <p className="text-xs text-neutral-500">列出并删除 S3 中未被引用的附件（图片等）。慎用！</p>
                </div>
                <div className="flex flex-row items-center space-x-2">
                    {loading && <ReactLoading width="1em" height="1em" type="spin" color="#8dd1d2" />}
                    <Button onClick={fetchUnusedFiles} title="扫描" />
                </div>
            </div>

            <Modal isOpen={isOpen} onRequestClose={() => setIsOpen(false)} style={{
                content: {
                    top: '50%',
                    left: '50%',
                    right: 'auto',
                    bottom: 'auto',
                    marginRight: '-50%',
                    transform: 'translate(-50%, -50%)',
                    width: '80%',
                    maxWidth: '800px',
                    maxHeight: '80vh',
                    borderRadius: '16px',
                    padding: '24px'
                },
                overlay: { backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000 }
            }}>
                <div className="flex flex-col h-full bg-w">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold t-primary">
                            {viewMode === 'cleanup' ? `待清理文件 (${cleanupFiles.length})` : `例外文件 (${exceptionFiles.length})`}
                        </h2>
                        <div className="flex items-center space-x-2">
                            <Button
                                title={viewMode === 'cleanup' ? '切换到例外视图' : '切换到清理视图'}
                                onClick={() => setViewMode(viewMode === 'cleanup' ? 'exceptions' : 'cleanup')}
                                secondary
                            />
                        </div>
                    </div>

                    {currentFiles.length > 0 && (
                        <div className="mb-2 flex items-center">
                            <label className="flex items-center space-x-1 text-sm cursor-pointer">
                                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
                                <span>全选</span>
                            </label>
                            <span className="text-xs text-neutral-400 ml-2">
                                (已选 {visibleSelectedCount} / {currentFiles.length})
                            </span>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto mb-4 border rounded-lg p-2">
                        {currentFiles.length === 0 ? (
                            <p className="p-4 text-center text-neutral-500">
                                {viewMode === 'cleanup' ? '未发现未使用的文件。' : '暂无例外文件。'}
                            </p>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b">
                                        <th className="p-2 w-8"></th>
                                        <th className="p-2 w-16">预览</th>
                                        <th className="p-2">Key</th>
                                        <th className="p-2 w-20">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentFiles.map(file => (
                                        <tr key={file.key} className="border-b hover:bg-neutral-50">
                                            <td className="p-2">
                                                <input type="checkbox" checked={selectedKeys.has(file.key)} onChange={() => toggleSelect(file.key)} />
                                            </td>
                                            <td className="p-2">
                                                <img src={file.url} alt="" className="w-12 h-12 object-cover rounded shadow-sm" />
                                            </td>
                                            <td className="p-2 text-xs break-all text-neutral-600">{file.key}</td>
                                            <td className="p-2">
                                                {viewMode === 'cleanup' ? (
                                                    <Button
                                                        title="加入例外"
                                                        onClick={() => toggleException(file.key)}
                                                        secondary
                                                    />
                                                ) : (
                                                    <Button
                                                        title="移除例外"
                                                        onClick={() => toggleException(file.key)}
                                                        secondary
                                                    />
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    <div className="flex justify-end space-x-4 sticky bottom-0 bg-w pt-2">
                        <Button onClick={() => setIsOpen(false)} title="取消" secondary />
                        {viewMode === 'cleanup' && (
                            <Button
                                onClick={handleCleanup}
                                title={`确认清理 (${visibleSelectedCount})`}
                            />
                        )}
                    </div>
                </div>
            </Modal>
            <AlertUI />
        </div>
    );
}

function ItemTitle({ title }: { title: string }) {
    return (
        <h1 className="text-sm t-primary pt-4">
            {title}
        </h1>
    );
}

function ItemSwitch({ title, description, type, configKey }: { title: string, description: string, configKey: string, type: 'client' | 'server' }) {
    const config = type === 'client' ? useContext(ClientConfigContext) : useContext(ServerConfigContext);
    const defaultValue = config?.default<boolean>(configKey);
    const [checked, setChecked] = useState(defaultValue);
    const [loading, setLoading] = useState(false);
    const { showAlert, AlertUI } = useAlert();
    const { t } = useTranslation();
    useEffect(() => {
        const value = config?.get<boolean>(configKey);
        if (value !== undefined) {
            setChecked(value);
        }
    }, [config]);
    function updateConfig(type: 'client' | 'server', key: string, value: any) {
        const checkedValue = checked
        setChecked(!checkedValue);
        setLoading(true);
        client.config({
            type
        }).post({
            [key]: value
        }, {
            headers: headersWithAuth()
        }).then(({ error }: { error: any }) => {
            if (error) {
                setChecked(checkedValue);
            }
            if (type === 'client') {
                const config = sessionStorage.getItem('config')
                if (config) {
                    sessionStorage.setItem('config', JSON.stringify({ ...JSON.parse(config), [key]: value }));
                } else {
                    sessionStorage.setItem('config', JSON.stringify({ [key]: value }));
                }
            }
            setLoading(false);
        }).catch((err) => {
            showAlert(t('settings.update_failed$message', { message: err.message }))
            setChecked(checkedValue);
            setLoading(false);
        })
    }
    return (
        <div className="flex flex-col w-full items-start">
            <div className="flex flex-row justify-between w-full items-center">
                <div className="flex flex-col">
                    <p className="text-lg font-bold dark:text-white">
                        {title}
                    </p>
                    <p className="text-xs text-neutral-500">
                        {description}
                    </p>
                </div>
                <div className="flex flex-row items-center justify-center space-x-4">
                    {loading && <ReactLoading width="1em" height="1em" type="spin" color="#8dd1d2" />}
                    <Switch.Root className="SwitchRoot" checked={checked} onCheckedChange={() => {
                        updateConfig(type, configKey, !checked);
                    }}>
                        <Switch.Thumb className="SwitchThumb" />
                    </Switch.Root>
                </div>
            </div>
            <AlertUI />
        </div >
    );
}

function ItemInput({ title, configKeyTitle, description, type, configKey }: { title: string, description: string, configKeyTitle: string, configKey: string, type: 'client' | 'server' }) {
    const config = type === 'client' ? useContext(ClientConfigContext) : useContext(ServerConfigContext);
    const defaultValue = config?.default<string>(configKey);
    const [value, setValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const { showAlert, AlertUI } = useAlert();

    const { t } = useTranslation();
    useEffect(() => {
        const value = config?.get<string>(configKey);
        if (value !== undefined) {
            setValue(value);
        }
    }, [config]);
    function updateConfig(type: 'client' | 'server', key: string, value: any) {
        setLoading(true);
        client.config({
            type
        }).post({
            [key]: value
        }, {
            headers: headersWithAuth()
        }).then(() => {
            if (type === 'client') {
                const config = sessionStorage.getItem('config')
                if (config) {
                    sessionStorage.setItem('config', JSON.stringify({ ...JSON.parse(config), [key]: value }));
                } else {
                    sessionStorage.setItem('config', JSON.stringify({ [key]: value }));
                }
            }
            setLoading(false);
        }).catch((err) => {
            showAlert(t('settings.update_failed$message', { message: err.message }))
            setValue(config?.get<string>(configKey) || "");
            setLoading(false);
        })
    }
    return (
        <div className="flex flex-col w-full items-start">
            <div className="flex flex-row justify-between w-full items-center">
                <div className="flex flex-col">
                    <p className="text-lg font-bold dark:text-white">
                        {title}
                    </p>
                    <p className="text-xs text-neutral-500">
                        {description}
                    </p>
                </div>
                <div className="flex flex-row items-center justify-center space-x-4">
                    {loading && <ReactLoading width="1em" height="1em" type="spin" color="#8dd1d2" />}
                    <Button title={t('update.title')} onClick={() => {
                        setIsOpen(true);
                    }} />
                </div>
            </div>
            <Modal isOpen={isOpen}
                shouldCloseOnOverlayClick={true}
                shouldCloseOnEsc={true}
                onRequestClose={() => { setIsOpen(false); }}
                style={{
                    content: {
                        top: '50%',
                        left: '50%',
                        right: 'auto',
                        bottom: 'auto',
                        marginRight: '-50%',
                        transform: 'translate(-50%, -50%)',
                        padding: '0',
                        border: 'none',
                        borderRadius: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        background: 'transparent',
                        width: '80%',
                        maxWidth: '40em'
                    },
                    overlay: {
                        backgroundColor: 'rgba(0, 0, 0, 0.2)',
                        zIndex: 1000
                    }
                }}
            >
                <div className="flex flex-col items-start p-4 bg-w space-y-4 w-full">
                    <h1 className="text-2xl font-bold t-primary">
                        {t('update$sth', { sth: configKeyTitle })}
                    </h1>
                    <textarea placeholder={defaultValue || configKeyTitle} value={value} onChange={(e) => {
                        setValue(e.target.value);
                    }} className="rounded-xl p-2 bg-secondary min-h-32 w-full t-primary" />
                    <div className="w-full flex flex-row items-center justify-center space-x-2 mt-4">
                        <Button onClick={() => {
                            setIsOpen(false);
                            updateConfig(type, configKey, value);
                        }} title={t('confirm')} />
                        <Button secondary onClick={() => {
                            setIsOpen(false);
                        }} title={t('cancel')} />
                    </div>
                </div>
            </Modal>
            <AlertUI />
        </div >
    );
}

function ItemButton({
    title,
    description,
    buttonTitle,
    onConfirm,
    alertTitle,
    alertDescription
}:
    {
        title: string,
        description: string,
        buttonTitle: string,
        onConfirm: () => Promise<void>,
        alertTitle: string,
        alertDescription: string,
    }) {
    const { showConfirm, ConfirmUI } = useConfirm();
    return (
        <div className="flex flex-col w-full items-start">
            <div className="flex flex-row justify-between w-full items-center">
                <div className="flex flex-col">
                    <p className="text-lg font-bold dark:text-white">
                        {title}
                    </p>
                    <p className="text-xs text-neutral-500">
                        {description}
                    </p>
                </div>
                <div className="flex flex-row items-center justify-center space-x-4">
                    <Button title={buttonTitle} onClick={() => {
                        showConfirm(alertTitle, alertDescription, onConfirm);
                    }} />
                </div>
            </div>
            <ConfirmUI />
        </div >
    );
}

function ItemWithUpload({
    title,
    description,
    accept,
    onFileChange,
}: {
    title: string;
    description: string;
    onFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
    accept: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation();

    const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        setLoading(true);
        try {
            await onFileChange(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col w-full items-start">
            <div className="flex flex-row justify-between w-full items-center">
                <div className="flex flex-col">
                    <p className="text-lg font-bold dark:text-white">{title}</p>
                    <p className="text-xs text-neutral-500">{description}</p>
                </div>
                <div className="flex flex-row items-center justify-center space-x-4">
                    {loading && (
                        <ReactLoading
                            width="1em"
                            height="1em"
                            type="spin"
                            color="#8dd1d2"
                        />
                    )}
                    <input
                        ref={inputRef}
                        type="file"
                        className="hidden"
                        accept={accept}
                        onChange={handleFileChange}
                    />
                    <Button
                        onClick={() => {
                            inputRef.current?.click();
                        }}
                        title={t("upload.title")}
                    />
                </div>
            </div>
        </div>
    );
}

function ItemAPIKey() {
    const { profile, setProfile } = useContext(ProfileContext);
    const { t } = useTranslation();
    const { showAlert, AlertUI } = useAlert();
    const { showConfirm, ConfirmUI } = useConfirm();
    const [loading, setLoading] = useState(false);

    if (!profile || !profile.permission) return null;

    async function resetAPIKey() {
        setLoading(true);
        try {
            const { data, error } = await client.user['api-key'].post(undefined, {
                headers: headersWithAuth()
            });
            if (error) {
                showAlert(error.value as string);
                return;
            }
            if (data && typeof data !== 'string') {
                setProfile({ ...profile!, apiKey: data.apiKey });
            }
        } catch (err: any) {
            showAlert(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function copyToClipboard() {
        if (profile?.apiKey) {
            await navigator.clipboard.writeText(profile.apiKey);
            showAlert(t('api_key.copy_success'));
        }
    }

    return (
        <div className="flex flex-col w-full items-start pb-4">
            <div className="flex flex-row justify-between w-full items-center">
                <div className="flex flex-col flex-1 mr-4">
                    <p className="text-lg font-bold dark:text-white">
                        {t('api_key.title')}
                    </p>
                    <p className="text-xs text-neutral-500">
                        {t('api_key.desc')}
                    </p>
                    {profile?.apiKey && (
                        <div className="bg-secondary p-2 rounded-lg mt-2 flex items-center justify-between">
                            <code className="text-sm t-primary break-all">{profile.apiKey}</code>
                            <button onClick={copyToClipboard} className="ml-2 text-theme text-sm shrink-0">
                                {t('api_key.copy')}
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex flex-row items-center justify-center space-x-4">
                    {loading && <ReactLoading width="1em" height="1em" type="spin" color="#8dd1d2" />}
                    <Button title={profile.apiKey ? t('api_key.reset') : t('create.title')} onClick={() => {
                        if (profile.apiKey) {
                            showConfirm(t('api_key.title'), t('api_key.reset_confirm'), resetAPIKey);
                        } else {
                            resetAPIKey();
                        }
                    }} />
                </div>
            </div>
            <AlertUI />
            <ConfirmUI />
        </div >
    );
}
