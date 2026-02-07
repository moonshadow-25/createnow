export interface AssetSelectorDialogProps {
  show: boolean;
  characters: any[];
  scenes: any[];
  props: any[];
  selectedCharacters: string[];
  setSelectedCharacters: (v: string[]) => void;
  selectedScene: string;
  setSelectedScene: (v: string) => void;
  selectedProps: string[];
  setSelectedProps: (v: string[]) => void;
  onClose: () => void;
}

export function AssetSelectorDialog({
  show,
  characters,
  scenes,
  props,
  selectedCharacters,
  setSelectedCharacters,
  selectedScene,
  setSelectedScene,
  selectedProps,
  setSelectedProps,
  onClose,
}: AssetSelectorDialogProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-6xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">选择资产</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* 三列布局：角色、场景、道具 */}
        <div className="flex-1 overflow-y-auto grid grid-cols-3 gap-4">
          {/* 角色列 - 多选 */}
          <div className="bg-gray-700 rounded p-4">
            <h4 className="font-bold text-blue-400 mb-3 flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-500 rounded"></span>
              角色 ({selectedCharacters.length})
            </h4>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {characters.length === 0 ? (
                <div className="text-sm text-gray-500 text-center p-4">暂无角色</div>
              ) : (
                characters.map((char) => (
                  <label key={char.asset_id} className="flex items-center gap-3 p-3 bg-gray-600 rounded cursor-pointer hover:bg-gray-500">
                    <input
                      type="checkbox"
                      checked={selectedCharacters.includes(char.asset_id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedCharacters([...selectedCharacters, char.asset_id]);
                        } else {
                          setSelectedCharacters(selectedCharacters.filter(id => id !== char.asset_id));
                        }
                      }}
                      className="rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{char.name}</div>
                      <div className="text-xs text-gray-400 truncate">{char.description || ''}</div>
                      {char.gender && (
                        <div className="text-xs text-gray-500">{char.gender}{char.age ? ` · ${char.age}岁` : ''}</div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* 场景列 - 单选 */}
          <div className="bg-gray-700 rounded p-4">
            <h4 className="font-bold text-green-400 mb-3 flex items-center gap-2">
              <span className="w-3 h-3 bg-green-500 rounded"></span>
              场景 {selectedScene && '(已选)'}
            </h4>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {scenes.length === 0 ? (
                <div className="text-sm text-gray-500 text-center p-4">暂无场景</div>
              ) : (
                scenes.map((scene) => (
                  <label key={scene.asset_id} className="flex items-center gap-3 p-3 bg-gray-600 rounded cursor-pointer hover:bg-gray-500">
                    <input
                      type="radio"
                      name="scene"
                      checked={selectedScene === scene.asset_id}
                      onChange={() => setSelectedScene(scene.asset_id)}
                      className="rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{scene.name}</div>
                      <div className="text-xs text-gray-400 truncate">{scene.description || ''}</div>
                      {scene.location && (
                        <div className="text-xs text-gray-500">{scene.location}</div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* 道具列 - 多选 */}
          <div className="bg-gray-700 rounded p-4">
            <h4 className="font-bold text-purple-400 mb-3 flex items-center gap-2">
              <span className="w-3 h-3 bg-purple-500 rounded"></span>
              道具 ({selectedProps.length})
            </h4>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {props.length === 0 ? (
                <div className="text-sm text-gray-500 text-center p-4">暂无道具</div>
              ) : (
                props.map((prop) => (
                  <label key={prop.asset_id} className="flex items-center gap-3 p-3 bg-gray-600 rounded cursor-pointer hover:bg-gray-500">
                    <input
                      type="checkbox"
                      checked={selectedProps.includes(prop.asset_id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedProps([...selectedProps, prop.asset_id]);
                        } else {
                          setSelectedProps(selectedProps.filter(id => id !== prop.asset_id));
                        }
                      }}
                      className="rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{prop.name}</div>
                      <div className="text-xs text-gray-400 truncate">{prop.description || ''}</div>
                      {prop.category && (
                        <div className="text-xs text-gray-500">{prop.category}</div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            取消
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
          >
            确认选择
          </button>
        </div>
      </div>
    </div>
  );
}
