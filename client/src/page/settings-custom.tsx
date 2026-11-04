import { Modal, SettingsCard, SettingsCardBody, SettingsCardHeader, SettingsCardRow } from "@rin/ui";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { client, endpoint } from "../app/runtime";
import { Button } from "../components/button";
import { useAlert, useConfirm } from "../components/dialog";
import { ConfigWrapper, defaultServerConfig } from "../state/config";
import { ProfileContext } from "../state/profile";

function getAuthHeaders(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)auth_token=([^;]*)/);
  const token = match ? decodeURIComponent(match[1]) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function CustomSettings() {
  return (
    <>
      <ItemCleanup />
      <ItemAPIKey />
    </>
  );
}

function ItemCleanup() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allFiles, setAllFiles] = useState<{ key: string; url: string; isException?: boolean }[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"cleanup" | "exceptions">("cleanup");
  const { showAlert, AlertUI } = useAlert();

  async function fetchUnusedFiles() {
    setLoading(true);
    try {
      const response = await fetch(`${endpoint}/storage/cleanup?excludeExceptions=false`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json();
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
    const keysToDelete = Array.from(selectedKeys).filter((key) => {
      const file = allFiles.find((f) => f.key === key);
      return file && !file.isException;
    });
    if (keysToDelete.length === 0) return;
    setLoading(true);
    try {
      const response = await fetch(`${endpoint}/storage/cleanup`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ keys: keysToDelete }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json();
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
    const { data } = await client.config.get("server");
    const freshConfig = new ConfigWrapper(data || {}, defaultServerConfig);
    const currentExceptions = freshConfig.get<string>("storage.cleanup.exceptions") || "";
    const file = allFiles.find((f) => f.key === key);
    if (!file) return;

    const lines = currentExceptions.split("\n").filter((s: string) => s.trim());
    const keyPart = key.includes("/") ? key.split("/").pop() || key : key;

    let newExceptions: string;
    if (file.isException) {
      const newLines = lines.filter((l: string) => !key.includes(l.trim()));
      newExceptions = newLines.join("\n");
    } else {
      lines.push(keyPart);
      newExceptions = lines.join("\n");
    }

    await client.config.update("server", { "storage.cleanup.exceptions": newExceptions });
    await fetchUnusedFiles();
  }

  const cleanupFiles = allFiles.filter((f) => !f.isException);
  const exceptionFiles = allFiles.filter((f) => f.isException);
  const currentFiles = viewMode === "cleanup" ? cleanupFiles : exceptionFiles;
  const visibleSelectedCount = Array.from(selectedKeys).filter((key) => {
    const file = allFiles.find((f) => f.key === key);
    return viewMode === "cleanup" ? file && !file.isException : file && file.isException;
  }).length;
  const allVisibleSelected = currentFiles.length > 0 && currentFiles.every((f) => selectedKeys.has(f.key));

  function toggleSelectAll() {
    const newSelected = new Set(selectedKeys);
    if (allVisibleSelected) {
      currentFiles.forEach((f) => newSelected.delete(f.key));
    } else {
      currentFiles.forEach((f) => newSelected.add(f.key));
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
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={
            <SettingsCardHeader
              title="清理未使用文件"
              description="列出并删除 S3/R2 中未被引用的附件（图片等）。慎用！"
            />
          }
          action={
            <>
              {loading && <ReactLoading width="1em" height="1em" type="spin" color="#8dd1d2" />}
              <Button onClick={fetchUnusedFiles} title="扫描" />
            </>
          }
        />
      </SettingsCard>

      <Modal
        isOpen={isOpen}
        onRequestClose={() => setIsOpen(false)}
        contentLabel="清理未使用文件"
        size="lg"
        panelClassName="p-6"
      >
        <div className="flex h-full flex-col bg-w">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold t-primary">
              {viewMode === "cleanup" ? `待清理文件 (${cleanupFiles.length})` : `例外文件 (${exceptionFiles.length})`}
            </h2>
            <div className="flex items-center space-x-2">
              <Button
                title={viewMode === "cleanup" ? "切换到例外视图" : "切换到清理视图"}
                onClick={() => setViewMode(viewMode === "cleanup" ? "exceptions" : "cleanup")}
                secondary
              />
            </div>
          </div>

          {currentFiles.length > 0 && (
            <div className="mb-2 flex items-center">
              <label className="flex cursor-pointer items-center space-x-1 text-sm">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
                <span>全选</span>
              </label>
              <span className="ml-2 text-xs text-neutral-400">
                (已选 {visibleSelectedCount} / {currentFiles.length})
              </span>
            </div>
          )}

          <div className="mb-4 max-h-96 flex-1 overflow-y-auto rounded-lg border p-2">
            {currentFiles.length === 0 ? (
              <p className="p-4 text-center text-neutral-500">
                {viewMode === "cleanup" ? "未发现未使用的文件。" : "暂无例外文件。"}
              </p>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b">
                    <th className="w-8 p-2"></th>
                    <th className="w-16 p-2">预览</th>
                    <th className="p-2">Key</th>
                    <th className="w-24 p-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {currentFiles.map((file) => (
                    <tr key={file.key} className="border-b hover:bg-neutral-50 dark:hover:bg-neutral-800">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(file.key)}
                          onChange={() => toggleSelect(file.key)}
                        />
                      </td>
                      <td className="p-2">
                        <img src={file.url} alt="" className="h-12 w-12 rounded object-cover shadow-sm" />
                      </td>
                      <td className="break-all p-2 text-xs text-neutral-600 dark:text-neutral-300">{file.key}</td>
                      <td className="p-2">
                        <Button
                          title={viewMode === "cleanup" ? "加入例外" : "移除例外"}
                          onClick={() => toggleException(file.key)}
                          secondary
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="sticky bottom-0 flex justify-end space-x-4 bg-w pt-2">
            <Button onClick={() => setIsOpen(false)} title="取消" secondary />
            {viewMode === "cleanup" && (
              <Button onClick={handleCleanup} title={`确认清理 (${visibleSelectedCount})`} />
            )}
          </div>
        </div>
      </Modal>
      <AlertUI />
    </div>
  );
}

function ItemAPIKey() {
  const profile = useContext(ProfileContext);
  const { t } = useTranslation();
  const { showAlert, AlertUI } = useAlert();
  const { showConfirm, ConfirmUI } = useConfirm();
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string>("");

  useEffect(() => {
    if (!profile?.permission) return;
    fetch(`${endpoint}/user/api-key`, {
      credentials: "include",
      headers: getAuthHeaders(),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.apiKey) {
          setApiKey(data.apiKey);
        }
      })
      .catch(() => {});
  }, [profile?.permission]);

  if (!profile || !profile.permission) return null;

  async function resetAPIKey() {
    setLoading(true);
    try {
      const response = await fetch(`${endpoint}/user/api-key`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        showAlert(await response.text());
        return;
      }
      const data = await response.json();
      if (data?.apiKey) {
        setApiKey(data.apiKey);
      }
    } catch (err: any) {
      showAlert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    if (apiKey) {
      await navigator.clipboard.writeText(apiKey);
      showAlert(t("api_key.copy_success"));
    }
  }

  return (
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={t("api_key.title")} description={t("api_key.desc")} />}
          action={
            <>
              {loading && <ReactLoading width="1em" height="1em" type="spin" color="#8dd1d2" />}
              <Button
                title={apiKey ? t("api_key.reset") : t("create.title")}
                onClick={() => {
                  if (apiKey) {
                    showConfirm(t("api_key.title"), t("api_key.reset_confirm"), resetAPIKey);
                  } else {
                    resetAPIKey();
                  }
                }}
              />
            </>
          }
        />
        {apiKey && (
          <SettingsCardBody>
            <div className="flex items-center justify-between rounded-lg bg-secondary p-2">
              <code className="break-all text-sm t-primary">{apiKey}</code>
              <button onClick={copyToClipboard} className="ml-2 shrink-0 text-sm text-theme">
                {t("api_key.copy")}
              </button>
            </div>
          </SettingsCardBody>
        )}
      </SettingsCard>
      <AlertUI />
      <ConfirmUI />
    </div>
  );
}
