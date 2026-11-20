package com.wz.reader

import java.io.File
import java.io.IOException

// The writer closes its streams before choosing the final extension. Until it returns, only a .part exists.
internal inline fun writeTemporaryImage(
  directory: File,
  prefix: String,
  checkActive: () -> Unit,
  write: (File) -> String
): File {
  checkActive()
  check(directory.mkdirs() || directory.isDirectory) { "无法创建图片文件。" }
  val partial = File.createTempFile(prefix, ".part", directory)
  try {
    val extension = write(partial)
    checkActive()
    val target = File(directory, "${partial.nameWithoutExtension}.$extension")
    // Android rename replaces an existing target. Our unique .part owns this stem while writing,
    // but a completed file from an earlier operation can still have the same stem.
    if (target.exists() || !partial.renameTo(target)) throw IOException("无法完成图片文件。")
    try {
      checkActive()
      return target
    } catch (error: Throwable) {
      target.delete()
      throw error
    }
  } finally {
    partial.delete()
  }
}

// One JS handle owns one operation and its completed file until release.
internal class TemporaryImageOperation {
  @Volatile private var canceled = false
  private var started = false
  private var cancelWork: (() -> Unit)? = null
  private var file: File? = null

  @Synchronized fun start(onCancel: (() -> Unit)? = null) {
    checkActive()
    check(!started) { "图片任务已经开始。" }
    started = true
    cancelWork = onCancel
  }

  fun checkActive() {
    if (canceled) throw IOException("图片任务已取消。")
  }

  @Synchronized fun publish(completed: File) {
    if (canceled) {
      completed.delete()
      throw IOException("图片任务已取消。")
    }
    file = completed
    cancelWork = null
  }

  @Synchronized fun cancel() {
    canceled = true
    cancelWork?.invoke()
    cancelWork = null
  }

  @Synchronized fun release() {
    cancel()
    file?.delete()
    file = null
  }
}
